const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2,
    fileSize: 2 * 1024 * 1024
  }
});

const MODELS = (
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash-lite,gemini-3.5-flash"
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.array("materiales", 2)(req, res, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function extract(file) {
  const name = (file.originalname || "").toLowerCase();
  const buffer = file.buffer;

  if (name.endsWith(".pdf")) {
    const result = await pdfParse(buffer);
    return result.text || "";
  }

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  if (/\.(txt|md|csv|html|htm)$/.test(name)) {
    return buffer
      .toString("utf8")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }

  throw new Error("Formato no compatible: " + file.originalname);
}

function buildPrompt(data, materials) {
  return `
Sos Edu.sistem pro ia, asistente especializado en planificación educativa para docentes argentinos.

Generá solamente el documento final, profesional y listo para copiar a Word.

TIPO DE TRABAJO:
${data.tipo || ""}

NIVEL:
${data.nivel || ""}

GRADO / CURSO:
${data.grado || ""}

ÁREA / MATERIA:
${data.area || ""}

TEMA:
${data.tema || ""}

DURACIÓN:
${data.duracion || ""}

INDICACIONES DEL DOCENTE:
${data.indicaciones || "Propuesta completa y adecuada al nivel."}

Usá los materiales enviados como contexto cuando sean pertinentes.
No inventes normativa oficial.
No menciones que sos una IA.
No agregues explicaciones sobre el proceso.
Entregá directamente el documento terminado.

MATERIALES DE REFERENCIA:
${materials || "(No se enviaron materiales.)"}
`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST,OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido."
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: "GEMINI_API_KEY no está configurada en Vercel."
    });
  }

  try {
    await runUpload(req, res);

    const data = req.body || {};

    if (typeof data.tipo === "string") {
      data.tipo = data.tipo.trim();
    }

    if (!data.tipo || !String(data.tema || "").trim()) {
      return res.status(400).json({
        error: "Indicá el tipo de trabajo y el tema."
      });
    }

    let materials = "";
    const used = [];

    for (const file of req.files || []) {
      try {
        const text = await extract(file);

        if (text.trim()) {
          materials +=
            `\n--- ${file.originalname} ---\n` +
            text.slice(0, 25000);

          used.push(file.originalname);
        }
      } catch (error) {
        // Se ignora un archivo que no pueda procesarse.
      }
    }

    const prompt = buildPrompt(
      data,
      materials.slice(0, 60000)
    );

    let lastError = "";

    for (const model of MODELS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }
              ],
              generationConfig: {
                maxOutputTokens: 10000
              }
            })
          }
        );

        const result = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          lastError =
            result?.error?.message ||
            `HTTP ${response.status}`;
          continue;
        }

        const text =
          (result?.candidates?.[0]?.content?.parts || [])
            .map(part => part.text || "")
            .join("\n")
            .trim();

        if (text) {
          return res.json({
            ok: true,
            texto: text,
            modelo: model,
            materialesUsados: used
          });
        }

        lastError =
          "Gemini no devolvió contenido.";
      } catch (error) {
        lastError = error.message;
      }
    }

    return res.status(502).json({
      error:
        "Gemini no pudo generar el documento. " +
        lastError
    });

  } catch (error) {
    return res.status(400).json({
      error:
        error.message ||
        "No se pudo procesar la solicitud."
    });
  }
};
