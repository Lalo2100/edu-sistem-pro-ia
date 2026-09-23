const express = require("express");
const path = require("path");
const multer = require("multer");

const app = express();

/* =========================
   CONFIGURACIÓN DE ARCHIVOS
   ========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024
  }
});

/* =========================
   MIDDLEWARE
   ========================= */

app.use(express.json({ limit: "2mb" }));

app.use(express.static(__dirname));

/* =========================
   SALUD DEL SERVIDOR
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
   PROMPT DE EDU.SISTEM
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

No inventes citas, normas, diseños curriculares ni documentos oficiales que no hayan sido proporcionados.

DATOS DEL TRABAJO

TIPO: ${kind}
NIVEL: ${nivel || "No indicado"}
GRADO/CURSO: ${grado || "No indicado"}
ÁREA/MATERIA: ${area || "No indicada"}
TEMA: ${tema}
DURACIÓN: ${duracion || "A definir"}

INDICACIONES DEL DOCENTE:

${indicaciones || "Sin indicaciones adicionales."}

MATERIALES DE REFERENCIA:

${materialesTexto || "No se adjuntaron materiales de referencia."}

INSTRUCCIONES PEDAGÓGICAS

Completá las secciones pedagógicas que correspondan al tipo de trabajo solicitado.

Para PLANIFICACIÓN ANUAL, considerá cuando sea pertinente:

- Fundamentación
- Propósitos
- Objetivos
- Aprendizajes
- Contenidos
- Contenidos prioritarios
- Ejes
- Organización temporal
- Cronograma
- Actividades
- Estrategias de enseñanza
- Recursos
- Evaluación
- Criterios de evaluación
- Bibliografía o fuentes cuando corresponda

Para SECUENCIA DIDÁCTICA, considerá cuando sea pertinente:

- Fundamentación
- Propósitos
- Objetivos
- Aprendizajes
- Contenidos
- Actividades de inicio
- Actividades de desarrollo
- Actividades de cierre
- Recursos
- Evaluación
- Criterios de evaluación
- Cronograma

Para PROYECTO, considerá además cuando corresponda:

- Fundamentación
- Propósitos
- Objetivos
- Aprendizajes
- Contenidos
- Producto final
- Etapas
- Actividades
- Organización
- Responsables
- Recursos
- Articulaciones
- Evaluación
- Criterios de evaluación

Para RÚBRICA:

Presentá una rúbrica clara y práctica.

Debe incluir:

- Criterios de evaluación
- Niveles de logro
- Descriptores claros para cada nivel
- Una tabla fácil de copiar a Word

IMPORTANTE

Respetá especialmente las indicaciones del docente sobre formato, extensión y organización.

Si el docente solicita una tabla, organizá la información en una tabla clara.

Si solicita un cronograma, organizalo de manera ordenada.

Si se proporcionaron materiales de referencia, utilizalos como contexto y referencia.

No inventes información que contradiga los materiales proporcionados.

No expliques cómo funciona la IA.

Entregá directamente el documento pedagógico solicitado.
`;
}

/* =========================
   GENERACIÓN CON GEMINI
   ========================= */

app.post(
  "/api/generar",
  upload.array("materiales"),
  async (req, res) => {

    const data = req.body || {};

    /* Verificación mínima */

    if (!data.tipo || !data.tema) {
      return res.status(400).json({
        error: "Indicá al menos el tipo de trabajo y el tema."
      });
    }

    /* API KEY */

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error:
          "La IA no está configurada. Agregá GEMINI_API_KEY en las variables de entorno de Vercel."
      });
    }

    try {

      /* Materiales enviados desde el formulario */

      const materiales = req.files || [];

      const materialesTexto = materiales
        .map((f) => {
          return (
            "\n--- MATERIAL DE REFERENCIA: " +
            f.originalname +
            " ---\n" +
            f.buffer.toString("utf8")
          );
        })
        .join("\n");

      /* Datos completos para el prompt */

      const datosParaPrompt = {
        ...data,
        materialesTexto
      };

      /* Consulta a Gemini */

      const r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
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
              temperature: 0.7,
              maxOutputTokens: 6000
            }
          })
        }
      );

      const j = await r.json();

      /* Error de Gemini */

      if (!r.ok) {

        console.error("Gemini error:", j);

        return res.status(502).json({
          error:
            j?.error?.message ||
            "Gemini no pudo generar el contenido."
        });
      }

      /* Obtener texto */

      const texto = (
        j?.candidates?.[0]?.content?.parts || []
      )
        .map((p) => p.text || "")
        .join("")
        .trim();

      /* Gemini respondió vacío */

      if (!texto) {

        return res.status(502).json({
          error:
            "Gemini no devolvió contenido. Probá nuevamente."
        });
      }

      /* Respuesta correcta */

      return res.json({
        ok: true,
        texto,
        modelo: "Gemini 2.5 Flash",
        materialesUsados: materiales.map(
          (f) => f.originalname
        )
      });

    } catch (err) {

      console.error(
        "Generation error:",
        err
      );

      return res.status(500).json({
        error:
          "No se pudo conectar con Gemini. Revisá la configuración del servidor."
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
   OTRAS RUTAS
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
