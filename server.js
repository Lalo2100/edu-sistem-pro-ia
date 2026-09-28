const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = "2.0";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 8, fileSize: 12 * 1024 * 1024 }
});

function loadLibrary() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "biblioteca.json"), "utf8"));
  } catch {
    return { version: VERSION, categorias: [], provincias: {} };
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".pdf") {
    const parsed = await pdfParse(file.buffer);
    return cleanText(parsed.text);
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return cleanText(result.value);
  }
  if ([".txt",".md",".csv",".html",".htm"].includes(ext)) {
    return cleanText(file.buffer.toString("utf8").replace(/<[^>]*>/g, " "));
  }
  return "";
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: VERSION,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    bibliotecaArgentina: true,
    provincias: Object.keys(loadLibrary().provincias || {}).length
  });
});

app.get("/api/biblioteca", (req, res) => {
  const lib = loadLibrary();
  res.json({
    version: lib.version,
    nombre: lib.nombre,
    categorias: lib.categorias,
    provincias: Object.entries(lib.provincias).map(([id, p]) => ({
      id,
      nombre: p.nombre,
      estado: p.estado,
      nota: p.nota,
      documentos: p.documentos || []
    }))
  });
});

app.post("/api/generar", upload.array("archivos", 8), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok:false, error:"GEMINI_API_KEY no está configurada en Vercel." });
    }

    const {
      tipo = "secuencia",
      provincia = "cordoba",
      nivel = "",
      grado = "",
      area = "",
      tema = "",
      duracion = "",
      indicaciones = "",
      categoriaBiblioteca = ""
    } = req.body || {};

    const lib = loadLibrary();
    const provinciaData = lib.provincias?.[provincia] || { nombre: provincia, documentos: [] };
    const docs = (provinciaData.documentos || [])
      .filter(d => !categoriaBiblioteca || d.categoria === categoriaBiblioteca)
      .slice(0, 12);

    const partes = [];
    for (const file of (req.files || [])) {
      const text = await extractFile(file);
      if (text) {
        partes.push(`MATERIAL APORTADO POR EL DOCENTE: ${file.originalname}\n${text.slice(0, 50000)}`);
      }
    }

    const documentosOficiales = docs.length
      ? docs.map(d => `- ${d.titulo} (${d.fuente}) ${d.url}`).join("\n")
      : "No hay documentos oficiales precargados para esta provincia/categoría. No inventes citas ni documentos.";

    const prompt = `
Sos Edu.sistem Pro IA, un asistente pedagógico para docentes de Argentina.

OBJETIVO:
Generar un ${tipo} claro, práctico y listo para que un docente pueda revisar y usar como base de trabajo.

DATOS:
Provincia: ${provinciaData.nombre || provincia}
Nivel: ${nivel}
Grado/Curso: ${grado}
Área/Materia: ${area}
Tema: ${tema}
Duración: ${duracion}
Indicaciones del docente: ${indicaciones}

BIBLIOTECA CURRICULAR:
${documentosOficiales}

MATERIALES SUBIDOS POR EL DOCENTE:
${partes.length ? partes.join("\n\n") : "No se adjuntaron materiales."}

REGLAS:
- Adaptá la propuesta a la provincia seleccionada.
- No atribuyas a una jurisdicción contenidos que no estén respaldados por el material disponible.
- Si no hay documentación provincial disponible, indicá de manera breve que debe verificarse con el diseño curricular vigente de la jurisdicción.
- Priorizá claridad, utilidad docente y lenguaje argentino.
- No uses encabezados llenos de # ni negritas con **.
- No escribas comentarios sobre cómo funciona la IA.
- No inventes resoluciones, números de normas, citas textuales ni documentos oficiales.
- Organizá el resultado con títulos simples y listas limpias.
- En una planificación/secuencia/proyecto incluí propósito/finalidad, objetivos, contenidos o saberes, actividades, recursos, evaluación y criterios cuando correspondan.
- En una rúbrica incluí criterios claros y niveles de logro.
- Entregá únicamente el trabajo solicitado.
`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt
    });

    const text = cleanText(response.text || "");
    if (!text) return res.status(502).json({ ok:false, error:"Gemini no devolvió contenido." });

    res.json({
      ok:true,
      resultado:text,
      provincia:provinciaData.nombre || provincia,
      modelo:MODEL
    });
  } catch (error) {
    console.error(error);
    const message = error?.message || "Error desconocido al generar.";
    res.status(500).json({ ok:false, error:message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Edu.sistem Pro IA ${VERSION} en puerto ${PORT}`));
