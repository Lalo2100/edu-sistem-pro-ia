const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 2, fileSize: 2 * 1024 * 1024 }
});

const bibliotecaPath = path.join(__dirname, "biblioteca-cordoba.json");
let biblioteca = { categorias: {} };

try {
  biblioteca = JSON.parse(fs.readFileSync(bibliotecaPath, "utf8"));
} catch (e) {
  console.error("No se pudo cargar biblioteca-cordoba.json:", e.message);
}

const MODELS = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite,gemini-3.5-flash")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

function limpiarResultado(texto) {
  return String(texto || "")
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

async function extraerTextoArchivo(file) {
  const name = (file.originalname || "").toLowerCase();

  if (name.endsWith(".pdf")) {
    return (await pdfParse(file.buffer)).text || "";
  }

  if (name.endsWith(".docx")) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value || "";
  }

  if (/\.(txt|md|csv|html|htm)$/.test(name)) {
    return file.buffer
      .toString("utf8")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }

  throw new Error("Formato no compatible: " + file.originalname);
}

function obtenerBibliotecaLocal(categorias) {
  const usadas = [];
  const bloques = [];

  for (const categoria of categorias || []) {
    const item = biblioteca.categorias?.[categoria];

    if (!item) continue;

    usadas.push(categoria);

    bloques.push(
      `REFERENCIA LOCAL — ${categoria}\n` +
      `Estado: ${item.estado || "referencia"}\n` +
      `${item.contenido || ""}`
    );
  }

  return {
    usadas,
    texto: bloques.join("\n\n")
  };
}

function buildPrompt(data, materiales, bibliotecaTexto) {
  return `Sos Edu.sistem Pro IA, asistente especializado en planificación educativa para docentes argentinos.

Generá solamente el documento final, profesional y listo para copiar a Word.

TIPO DE TRABAJO: ${data.tipo || ""}
NIVEL: ${data.nivel || ""}
GRADO / CURSO: ${data.grado || ""}
ÁREA / MATERIA: ${data.area || ""}
TEMA: ${data.tema || ""}
DURACIÓN: ${data.duracion || ""}
INDICACIONES DEL DOCENTE: ${data.indicaciones || "Propuesta completa y adecuada al nivel."}

BIBLIOTECA CURRICULAR CÓRDOBA — CONTENIDO LOCAL:
${bibliotecaTexto || "(No se seleccionaron referencias de la biblioteca local.)"}

MATERIALES DEL DOCENTE:
${materiales || "(No se enviaron materiales.)"}

Reglas:
- Usá las referencias locales cuando sean pertinentes.
- La Biblioteca Curricular Córdoba es local: NO intentes descargar documentos ni consultar sitios web para completar estas referencias.
- No inventes normativa oficial, documentos, resoluciones ni contenidos curriculares específicos que no estén en las referencias recibidas.
- Si una categoría está marcada como referencia general o material en consulta, no la presentes como un diseño curricular definitivo específico.
- Si el docente aporta materiales, priorizá esos materiales cuando correspondan al tema.
- Adaptá la propuesta al nivel, grado/curso, área, tema y duración indicados.
- No menciones que sos una IA.
- No agregues explicaciones sobre el proceso.
- Entregá directamente el documento terminado.
- Evitá Markdown visible como **, # o \`\`\`.
- Usá títulos claros y texto limpio, listo para Word.`;
}

async function llamarGemini(modelo, prompt) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error("GEMINI_API_KEY no configurada.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(modelo)}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const raw = await response.text();

  let json = {};
  try {
    json = JSON.parse(raw);
  } catch (_) {}

  if (!response.ok) {
    const error = new Error(
      json?.error?.message || `Gemini HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return (
    json?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("") || ""
  );
}

async function generarConGemini(prompt) {
  let ultimoError;

  for (const modelo of MODELS) {
    try {
      const texto = await llamarGemini(modelo, prompt);

      return {
        texto: limpiarResultado(texto),
        modelo
      };
    } catch (error) {
      ultimoError = error;

      if (![429, 503].includes(error.status)) {
        continue;
      }
    }
  }

  throw ultimoError || new Error("No fue posible generar el documento.");
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: "3.1-local",
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    bibliotecaCordoba: true,
    bibliotecaModo: "local",
    categoriasBiblioteca: Object.keys(biblioteca.categorias || {})
  });
});

app.post("/api/generar", upload.array("materiales", 2), async (req, res) => {
  try {
    const categoriasRaw = req.body.bibliotecaCategorias;

    const categorias = Array.isArray(categoriasRaw)
      ? categoriasRaw
      : categoriasRaw
        ? [categoriasRaw]
        : [];

    const bibliotecaLocal = obtenerBibliotecaLocal(categorias);

    const partesMateriales = [];
    const materialesUsados = [];

    for (const file of req.files || []) {
      const texto = (await extraerTextoArchivo(file)).slice(0, 20000);

      partesMateriales.push(
        `MATERIAL DEL DOCENTE — ${file.originalname}:\n${texto}`
      );

      materialesUsados.push(file.originalname);
    }

    const prompt = buildPrompt(
      req.body,
      partesMateriales.join("\n\n"),
      bibliotecaLocal.texto
    );

    const resultado = await generarConGemini(prompt);

    res.json({
      ok: true,
      texto: resultado.texto,
      modelo: resultado.modelo,
      materialesUsados,
      bibliotecaUsada: bibliotecaLocal.usadas,
      bibliotecaModo: "local"
    });
  } catch (error) {
    console.error("Error /api/generar:", error);

    res.status(500).json({
      ok: false,
      error: error.message || "Error de generación"
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Edu.sistem Pro IA en puerto ${PORT}`);
  });
}

module.exports = app;
