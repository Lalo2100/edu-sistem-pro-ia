const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

const app = express();

const VERSION = "2.1";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(express.json({ limit: "4mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 12 * 1024 * 1024
  }
});

function loadLibrary() {
  try {
    const file = path.join(__dirname, "biblioteca.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error("Error cargando biblioteca.json:", error);
    return {
      version: VERSION,
      nombre: "Biblioteca Curricular Argentina",
      categorias: [],
      provincias: {}
    };
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
    const result = await mammoth.extractRawText({
      buffer: file.buffer
    });
    return cleanText(result.value);
  }

  if ([".txt", ".md", ".csv", ".html", ".htm"].includes(ext)) {
    return cleanText(
      file.buffer
        .toString("utf8")
        .replace(/<[^>]*>/g, " ")
    );
  }

  return "";
}

/* =========================
   HEALTH
========================= */

app.get("/api/health", (req, res) => {
  const library = loadLibrary();

  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: VERSION,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    bibliotecaArgentina: true,
    provincias: Object.keys(library.provincias || {}).length
  });
});

/* =========================
   BIBLIOTECA
========================= */

app.get("/api/biblioteca", (req, res) => {
  try {
    const library = loadLibrary();

    const provincias = Object.entries(
      library.provincias || {}
    ).map(([id, provincia]) => ({
      id,
      nombre: provincia.nombre || id,
      estado: provincia.estado || "Disponible",
      nota: provincia.nota || "",
      documentos: provincia.documentos || []
    }));

    res.json({
      ok: true,
      version: library.version || VERSION,
      nombre:
        library.nombre ||
        "Biblioteca Curricular Argentina",
      categorias: library.categorias || [],
      provincias
    });
  } catch (error) {
    console.error("Error en /api/biblioteca:", error);

    res.status(500).json({
      ok: false,
      error: "No se pudo cargar la biblioteca curricular."
    });
  }
});

/* =========================
   GENERAR
========================= */

app.post(
  "/api/generar",
  upload.array("archivos", 8),
  async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(503).json({
          ok: false,
          error:
            "GEMINI_API_KEY no está configurada en Vercel."
        });
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

      const library = loadLibrary();

      const provinciaData =
        library.provincias?.[provincia] || {
          nombre: provincia,
          documentos: []
        };

      const documentos = (
        provinciaData.documentos || []
      )
        .filter(
          documento =>
            !categoriaBiblioteca ||
            documento.categoria === categoriaBiblioteca
        )
        .slice(0, 12);

      const materiales = [];

      for (const file of req.files || []) {
        const texto = await extractFile(file);

        if (texto) {
          materiales.push(
            `MATERIAL APORTADO POR EL DOCENTE: ${file.originalname}\n${texto.slice(
              0,
              50000
            )}`
          );
        }
      }

      const documentosOficiales = documentos.length
        ? documentos
            .map(
              documento =>
                `- ${documento.titulo || ""} (${documento.fuente || ""}) ${
                  documento.url || ""
                }`
            )
            .join("\n")
        : "No hay documentos oficiales precargados para esta provincia/categoría. No inventes citas ni documentos.";

      const prompt = `
Sos Edu.sistem Pro IA, un asistente pedagógico para docentes de Argentina.

OBJETIVO:
Generar un ${tipo} claro, práctico y listo para que un docente pueda revisar y usar como base de trabajo.

DATOS DEL DOCENTE:

Provincia:
${provinciaData.nombre || provincia}

Nivel:
${nivel}

Grado/Curso:
${grado}

Área/Materia:
${area}

Tema:
${tema}

Duración:
${duracion}

Indicaciones del docente:
${indicaciones}

BIBLIOTECA CURRICULAR:

${documentosOficiales}

MATERIALES APORTADOS POR EL DOCENTE:

${
  materiales.length
    ? materiales.join("\n\n")
    : "No se adjuntaron materiales."
}

REGLAS:

- Adaptá la propuesta a la provincia seleccionada.
- No atribuyas contenidos de una jurisdicción a otra.
- No inventes documentos oficiales.
- No inventes resoluciones ni números de normas.
- Si no existe documentación provincial disponible, indicá brevemente que debe verificarse con el diseño curricular vigente.
- Priorizá claridad y utilidad docente.
- Utilizá lenguaje argentino.
- No uses encabezados llenos de #.
- No uses negritas con **.
- No escribas comentarios sobre cómo funciona la IA.
- Organizá el resultado con títulos simples y listas limpias.
- En planificación, secuencia o proyecto incluí los elementos pedagógicos correspondientes.
- En rúbrica incluí criterios claros y niveles de logro.
- Entregá únicamente el trabajo solicitado.
`;

      const ai = new GoogleGenAI({
        apiKey
      });

      const response =
        await ai.models.generateContent({
          model: MODEL,
          contents: prompt
        });

      const resultado = cleanText(
        response.text || ""
      );

      if (!resultado) {
        return res.status(502).json({
          ok: false,
          error:
            "Gemini no devolvió contenido."
        });
      }

      res.json({
        ok: true,
        resultado,
        provincia:
          provinciaData.nombre || provincia,
        modelo: MODEL
      });
    } catch (error) {
      console.error(
        "Error en /api/generar:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "Error desconocido al generar."
      });
    }
  }
);

/* =========================
   SERVIR INDEX.HTML
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================
   ARCHIVOS ESTÁTICOS
========================= */

app.get("/logo.svg", (req, res) => {
  res.sendFile(
    path.join(__dirname, "logo.svg")
  );
});

/* =========================
   VERCEL
========================= */

module.exports = app;

/* =========================
   SERVIDOR LOCAL
========================= */

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      `Edu.sistem Pro IA ${VERSION} funcionando en puerto ${PORT}`
    );
  });
}
