const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

/* =========================
   SALUD
   ========================= */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: "1.1",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

/* =========================
   EXTRAER TEXTO
   ========================= */

async function extraerTextoArchivo(file) {
  const nombre = file.originalname.toLowerCase();

  if (nombre.endsWith(".pdf")) {
    const resultado = await pdfParse(file.buffer);
    return resultado.text || "";
  }

  if (
    nombre.endsWith(".docx") ||
    nombre.endsWith(".doc")
  ) {
    const resultado = await mammoth.extractRawText({
      buffer: file.buffer
    });

    return resultado.value || "";
  }

  return file.buffer.toString("utf8");
}

/* =========================
   LIMPIAR RESULTADO
   ========================= */

function limpiarMarkdown(texto) {
  if (!texto) return "";

  let salida = texto;

  salida = salida.replace(/^#{1,6}\s*/gm, "");

  salida = salida.replace(/\*\*(.*?)\*\*/g, "$1");

  salida = salida.replace(/__(.*?)__/g, "$1");

  salida = salida.replace(/^\s*[-*]\s+/gm, "• ");

  salida = salida.replace(/^\s*>\s?/gm, "");

  salida = salida.replace(/\n{3,}/g, "\n\n");

  return salida.trim();
}

/* =========================
   PROMPT
   ========================= */

function buildPrompt({
  tipo,
  nivel,
  grado,
  area,
  tema,
  duracion,
  indicaciones,
  materialesTexto
}) {
  const names = {
    anual: "PLANIFICACIÓN ANUAL",
    secuencia: "SECUENCIA DIDÁCTICA",
    proyecto: "PROYECTO",
    rubrica: "RÚBRICA"
  };

  const kind = names[tipo] || "PROPUESTA DOCENTE";

  return `Sos Edu.sistem pro ia, un asistente de apoyo para docentes de Argentina.

Generá directamente un documento pedagógico completo, claro, profesional y listo para editar.

Usá español argentino.

No inventes citas, normas, diseños curriculares ni documentos oficiales.

Si se proporcionan materiales de referencia, utilizalos como fuente contextual para elaborar el documento. No los menciones innecesariamente y no inventes información que contradiga esos materiales.

DATOS DEL TRABAJO

TIPO: ${kind}
NIVEL: ${nivel || "No indicado"}
GRADO/CURSO: ${grado || "No indicado"}
ÁREA/MATERIA: ${area || "No indicada"}
TEMA: ${tema}
DURACIÓN: ${duracion || "A definir"}

INDICACIONES DEL DOCENTE

${indicaciones || "Sin indicaciones adicionales."}

MATERIALES DE REFERENCIA

${materialesTexto || "No se adjuntaron materiales de referencia."}

CRITERIOS DE REDACCIÓN

El documento debe ser claro, ordenado y profesional.

No utilices Markdown.

No uses:
#
##
###
**
***

Usá títulos y subtítulos escritos normalmente.

Podés utilizar listas con guiones simples si son necesarias.

No expliques cómo funciona la IA.

Entregá directamente el documento.

Para PLANIFICACIÓN ANUAL considerá, cuando corresponda:

Fundamentación
Propósitos
Objetivos
Aprendizajes
Contenidos
Contenidos prioritarios
Ejes
Organización temporal
Cronograma
Actividades
Estrategias de enseñanza
Recursos
Evaluación
Criterios de evaluación
Bibliografía o fuentes

Para SECUENCIA DIDÁCTICA considerá:

Fundamentación
Propósitos
Objetivos
Aprendizajes
Contenidos
Inicio
Desarrollo
Cierre
Recursos
Evaluación
Criterios de evaluación
Cronograma

Para PROYECTO considerá:

Fundamentación
Propósitos
Objetivos
Aprendizajes
Contenidos
Producto final
Etapas
Actividades
Organización
Responsables
Recursos
Articulaciones
Evaluación

Para RÚBRICA:

Presentá criterios de evaluación y niveles de logro de manera clara.

Si una tabla resulta necesaria, organizá la información de manera que pueda copiarse fácilmente a Word.

Respetá especialmente las indicaciones del docente sobre formato, extensión y organización.

Entregá únicamente el documento final.`;
}

/* =========================
   GENERACIÓN
   ========================= */

app.post(
  "/api/generar",
  upload.array("materiales"),
  async (req, res) => {

    const data = req.body || {};

    if (!data.tipo || !data.tema) {
      return res.status(400).json({
        error: "Indicá al menos el tipo de trabajo y el tema."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error:
          "La IA no está configurada. Agregá GEMINI_API_KEY en Vercel."
      });
    }

    try {

      const materiales = req.files || [];

      const materialesProcesados = [];

      for (const file of materiales) {
        try {
          const texto = await extraerTextoArchivo(file);

          if (texto && texto.trim()) {
            materialesProcesados.push({
              nombre: file.originalname,
              texto: texto.trim()
            });
          }
        } catch (error) {
          console.error(
            "Error leyendo material:",
            file.originalname,
            error
          );
        }
      }

      const materialesTexto =
        materialesProcesados
          .map(
            (m) =>
              `--- MATERIAL: ${m.nombre} ---\n${m.texto}`
          )
          .join("\n\n");

      const datosParaPrompt = {
        ...data,
        materialesTexto
      };

      const respuesta = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },

          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: buildPrompt(datosParaPrompt)
                  }
                ]
              }
            ],

            generationConfig: {
              maxOutputTokens: 6000
            }
          })
        }
      );

      const resultado = await respuesta.json();

      if (!respuesta.ok) {

        console.error(
          "Gemini error:",
          resultado
        );

        return res.status(502).json({
          error:
            resultado?.error?.message ||
            "Gemini no pudo generar el contenido."
        });
      }

      const textoGenerado =
        (
          resultado?.candidates?.[0]?.content?.parts ||
          []
        )
          .map((parte) => parte.text || "")
          .join("")
          .trim();

      if (!textoGenerado) {
        return res.status(502).json({
          error:
            "Gemini no devolvió contenido. Probá nuevamente."
        });
      }

      const textoFinal =
        limpiarMarkdown(textoGenerado);

      return res.json({
        ok: true,
        texto: textoFinal,
        modelo: "Gemini 3.6 Flash",
        materialesUsados:
          materialesProcesados.map(
            (m) => m.nombre
          )
      });

    } catch (error) {

      console.error(
        "Generation error:",
        error
      );

      return res.status(500).json({
        error:
          "No se pudo generar el trabajo. Revisá los registros de Vercel."
      });
    }
  }
);

/* =========================
   PÁGINA PRINCIPAL
   ========================= */

app.get("/", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================
   RUTAS RESTANTES
   ========================= */

app.get("*", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================
   EXPORTACIÓN
   ========================= */

module.exports = app;

/* =========================
   SERVIDOR LOCAL
   ========================= */

if (require.main === module) {

  const PORT =
    process.env.PORT || 3021;

  app.listen(PORT, () => {

    console.log(
      `Edu.sistem pro ia funcionando en http://localhost:${PORT}`
    );

  });
}
