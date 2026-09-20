const express = require("express");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();
const PORT = process.env.PORT || 3021;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 }
});

const materials = new Map();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: "1.1",
    provider: "Gemini",
    configured: Boolean(GEMINI_API_KEY)
  });
});

app.post("/api/materiales", upload.single("material"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Seleccioná un archivo." });

  const original = req.file.originalname;
  const ext = path.extname(original).toLowerCase();
  let texto = "";

  try {
    if ([".txt", ".md", ".csv"].includes(ext)) {
      texto = fs.readFileSync(req.file.path, "utf8");
    } else if ([".html", ".htm"].includes(ext)) {
      texto = fs.readFileSync(req.file.path, "utf8")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
    } else if (ext === ".pdf") {
      const data = await pdfParse(fs.readFileSync(req.file.path));
      texto = data.text || "";
    } else if (ext === ".docx") {
      const data = await mammoth.extractRawText({ path: req.file.path });
      texto = data.value || "";
    } else {
      throw new Error("Formato no compatible. Usá PDF, Word (.docx), TXT, MD, CSV o HTML.");
    }

    texto = texto.trim();
    if (!texto) throw new Error("No se encontró texto legible en el archivo.");

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    materials.set(id, {
      id,
      nombre: original,
      texto: texto.slice(0, 50000)
    });

    fs.unlink(req.file.path, () => {});
    res.json({
      ok: true,
      material: { id, nombre: original, caracteres: texto.length }
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message || "No se pudo leer el archivo." });
  }
});

app.get("/api/materiales", (_req, res) => {
  res.json({
    ok: true,
    materiales: [...materials.values()].map(m => ({
      id: m.id,
      nombre: m.nombre,
      caracteres: m.texto.length
    }))
  });
});

app.delete("/api/materiales/:id", (req, res) => {
  materials.delete(req.params.id);
  res.json({ ok: true });
});

function tipoNombre(tipo) {
  return ({
    anual: "PLANIFICACIÓN ANUAL",
    secuencia: "SECUENCIA DIDÁCTICA",
    proyecto: "PROYECTO",
    evaluacion: "EVALUACIÓN",
    material: "MATERIAL EDUCATIVO",
    efemeride: "EFEMÉRIDE",
    acto: "ACTO ESCOLAR"
  })[tipo] || "PROPUESTA DOCENTE";
}

function construirPrompt(data, seleccionados) {
  const referencias = seleccionados.length
    ? seleccionados.map((m, i) =>
        `\n--- MATERIAL DE REFERENCIA ${i + 1}: ${m.nombre} ---\n${m.texto}`
      ).join("\n").slice(0, 90000)
    : "\nNo se seleccionaron materiales de referencia.";

  return `Sos Edu.sistem pro ia, un asistente especializado en planificación y producción de materiales educativos para docentes argentinos.

Generá un documento docente completo, claro, profesional y directamente utilizable.
IMPORTANTE:
- Respetá el nivel, grado/curso, área, tema y duración indicados.
- Si hay materiales de referencia seleccionados, utilizalos como fuente principal para orientar aprendizajes, contenidos, enfoques y terminología.
- No inventes que un contenido aparece en una fuente si no está allí.
- No copies extensos fragmentos literalmente; sintetizá y adaptá.
- Si las fuentes contienen estructuras institucionales, conservá sus secciones relevantes.
- Seguí las indicaciones del docente.
- No menciones que sos una IA ni expliques el proceso.
- Entregá solamente el documento final.
- Usá títulos, subtítulos, viñetas y tablas en Markdown cuando ayuden a organizarlo.

TIPO: ${tipoNombre(data.tipo)}
NIVEL: ${data.nivel || "No indicado"}
GRADO/CURSO: ${data.grado || "No indicado"}
ÁREA/MATERIA: ${data.area || "No indicada"}
TEMA: ${data.tema}
DURACIÓN: ${data.duracion || "A definir"}

INDICACIONES DEL DOCENTE:
${data.indicaciones || "Desarrollá una propuesta completa y adecuada al nivel."}

MATERIALES DE REFERENCIA:
${referencias}
`;
}

app.post("/api/generar", async (req, res) => {
  const data = req.body || {};
  if (!data.tipo || !data.tema) {
    return res.status(400).json({ error: "Indicá al menos el tipo de trabajo y el tema." });
  }

  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: "Gemini no está configurado en el servidor. En Render agregá la variable GEMINI_API_KEY y volvé a desplegar."
    });
  }

  const ids = Array.isArray(data.materialIds) ? data.materialIds : [];
  const seleccionados = ids.map(id => materials.get(id)).filter(Boolean);
  const prompt = construirPrompt(data, seleccionados);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      }
    );

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = body?.error?.message || `Gemini respondió con HTTP ${response.status}.`;
      return res.status(502).json({ error: `Error de Gemini: ${detail}` });
    }

    const texto = (body?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "")
      .join("\n")
      .trim();

    if (!texto) {
      return res.status(502).json({ error: "Gemini no devolvió contenido. Intentá nuevamente." });
    }

    res.json({
      ok: true,
      texto,
      materialesUsados: seleccionados.map(m => m.nombre),
      modelo: GEMINI_MODEL
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({
      error: "No se pudo conectar con Gemini. Verificá GEMINI_API_KEY y la conexión del servidor."
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Edu.sistem pro ia funcionando en http://localhost:${PORT}`);
});
