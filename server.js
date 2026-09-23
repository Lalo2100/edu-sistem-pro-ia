const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "2mb" }));

// En Vercel, index.html está en la raíz del proyecto
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: "1.1",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

function buildPrompt({
  tipo,
  nivel,
  grado,
  area,
  tema,
  duracion,
  indicaciones
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

No inventes citas, normas, diseños curriculares ni documentos oficiales que no hayan sido proporcionados.
Usá español argentino.

TIPO: ${kind}
NIVEL: ${nivel || "No indicado"}
GRADO/CURSO: ${grado || "No indicado"}
ÁREA/MATERIA: ${area || "No indicada"}
TEMA: ${tema}
DURACIÓN: ${duracion || "A definir"}

INDICACIONES DEL DOCENTE:
${indicaciones || "Sin indicaciones adicionales."}

Completá las secciones pedagógicas que correspondan.

Para planificación o secuencia, considerá cuando sea pertinente:
Fundamentación; Propósitos; Objetivos; Aprendizajes; Contenidos; Contenidos prioritarios; Ejes; Tiempo/Cronograma; Actividades de inicio, desarrollo y cierre; Recursos; Evaluación; Criterios de evaluación; Bibliografía o fuentes solo si corresponde.

Para proyecto, agregá además producto final, etapas, responsables y articulaciones cuando sean pertinentes.

Para rúbrica, presentá criterios y niveles de logro en una tabla clara.

Respetá especialmente las indicaciones del docente sobre formato, extensión y organización.

No expliques cómo funciona la IA. Entregá directamente el documento.`;
}

app.post("/api/generar", upload.array("materiales"), async (req, res) => {
  const data = req.body || {};

  if (!data.tipo || !data.tema) {
    return res.status(400).json({
      error: "Indicá al menos el tipo de trabajo y el tema."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "La IA no está configurada. Agregá GEMINI_API_KEY en Vercel."
    });
  }

  try {
    const materiales = req.files || [];

    const materialesTexto = materiales.map((f) => {
      return `\n--- MATERIAL DE REFERENCIA: ${f.originalname} ---\n${f.buffer.toString("utf8")}`;
    }).join("\n");

    const datosParaPrompt = {
      ...data,
      materialesTexto
    };

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

    if (!r.ok) {
      console.error("Gemini error:", j);

      return res.status(502).json({
        error: j?.error?.message || "Gemini no pudo generar el contenido."
      });
    }

    const texto = (j?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "")
      .join("")
      .trim();

    if (!texto) {
      return res.status(502).json({
        error: "Gemini no devolvió contenido. Probá nuevamente."
      });
    }

    res.json({
      ok: true,
      texto,
      modelo: "Gemini 2.5 Flash",
      materialesUsados: materiales.map(f => f.originalname)
    });

  } catch (err) {
    console.error("Generation error:", err);

    res.status(500).json({
      error: "No se pudo generar el trabajo. Revisá los registros de Vercel."
    });
  }
});

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "La IA no está configurada. Agregá GEMINI_API_KEY en las variables de entorno de Vercel."
    });
  }

  try {
    const r = await fetch(
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
                  text: buildPrompt(data)
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

    if (!r.ok) {
      console.error("Gemini error", j);

      return res.status(502).json({
        error:
          j?.error?.message ||
          "Gemini no pudo generar el contenido."
      });
    }

    const texto = (j?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "")
      .join("")
      .trim();

    if (!texto) {
      return res.status(502).json({
        error: "Gemini no devolvió contenido. Probá nuevamente."
      });
    }

    res.json({
      ok: true,
      texto
    });

  } catch (err) {
    console.error("Generation error", err);

    res.status(500).json({
      error: "No se pudo conectar con Gemini. Revisá la configuración del servidor."
    });
  }
});

// Página principal
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Para otras rutas de la aplicación
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3021;

  app.listen(PORT, () => {
    console.log(
      `Edu.sistem pro ia funcionando en http://localhost:${PORT}`
    );
  });
}
