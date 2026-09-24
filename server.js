const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();

/* =========================================================
   CONFIGURACIÓN DE ARCHIVOS
   ========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Edu.sistem pro ia",
    version: "1.1",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

/* =========================================================
   LECTURA DE MATERIALES
   ========================================================= */

async function extraerTextoArchivo(file) {
  const nombre = (file.originalname || "").toLowerCase();

  /* PDF */
  if (nombre.endsWith(".pdf")) {
    const resultado = await pdfParse(file.buffer);
    return resultado.text || "";
  }

  /* WORD */
  if (
    nombre.endsWith(".docx") ||
    nombre.endsWith(".doc")
  ) {
    const resultado = await mammoth.extractRawText({
      buffer: file.buffer
    });

    return resultado.value || "";
  }

  /* TXT, MD, CSV, HTML y otros textos */
  return file.buffer.toString("utf8");
}

/* =========================================================
   LIMPIEZA DEL TEXTO GENERADO
   ========================================================= */

function limpiarResultado(texto) {
  if (!texto) return "";

  let salida = texto;

  /* Eliminar encabezados Markdown */
  salida = salida.replace(/^#{1,6}\s*/gm, "");

  /* Eliminar negritas Markdown */
  salida = salida.replace(/\*\*(.*?)\*\*/g, "$1");

  /* Eliminar cursivas Markdown */
  salida = salida.replace(/\*(.*?)\*/g, "$1");

  /* Eliminar guiones de listas y convertirlos en viñetas */
  salida = salida.replace(/^\s*[-*]\s+/gm, "• ");

  /* Eliminar blockquotes */
  salida = salida.replace(/^\s*>\s?/gm, "");

  /* Eliminar separadores */
  salida = salida.replace(/^\s*[-*_]{3,}\s*$/gm, "");

  /* Evitar demasiados saltos */
  salida = salida.replace(/\n{3,}/g, "\n\n");

  return salida.trim();
}

/* =========================================================
   PROMPT
   ========================================================= */

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
  const nombres = {
    anual: "PLANIFICACIÓN ANUAL",
    secuencia: "SECUENCIA DIDÁCTICA",
    proyecto: "PROYECTO",
    rubrica: "RÚBRICA"
  };

  const tipoTrabajo =
    nombres[tipo] || "PROPUESTA DOCENTE";

  return `
Sos Edu.sistem pro ia, un asistente de apoyo para docentes de Argentina.

Tu tarea es elaborar directamente un documento pedagógico completo, claro, profesional y práctico.

Utilizá español argentino.

IMPORTANTE SOBRE LOS MATERIALES DE REFERENCIA:

Los materiales proporcionados por el docente son fuentes de referencia.

Si se adjunta un Diseño Curricular, programa, documento institucional u otro material pedagógico, analizá su contenido y utilizalo para fundamentar y seleccionar aprendizajes, contenidos, objetivos, ejes, criterios y actividades cuando corresponda.

No inventes información que contradiga los materiales proporcionados.

No inventes citas, páginas, resoluciones, documentos oficiales ni referencias que no aparezcan en los materiales o que no sean necesarias.

DATOS DEL TRABAJO

Tipo de trabajo:
${tipoTrabajo}

Nivel:
${nivel || "No indicado"}

Grado / Curso:
${grado || "No indicado"}

Área / Materia:
${area || "No indicada"}

Tema:
${tema}

Duración:
${duracion || "A definir"}

INDICACIONES DEL DOCENTE:

${indicaciones || "Sin indicaciones adicionales."}

MATERIALES DE REFERENCIA:

${materialesTexto || "No se adjuntaron materiales de referencia."}

REGLAS DE PRESENTACIÓN:

Entregá directamente el documento final.

No expliques cómo funciona la inteligencia artificial.

No utilices Markdown.

No utilices:
#
##
###
**
***
ni otros símbolos Markdown para organizar el documento.

Usá títulos claros escritos normalmente.

Usá subtítulos claros.

Cuando corresponda, utilizá listas con viñetas.

El documento debe ser cómodo para copiar y pegar en Word.

TIPO DE DOCUMENTO:

Si es PLANIFICACIÓN ANUAL, incluí cuando corresponda:

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

Si es SECUENCIA DIDÁCTICA, incluí cuando corresponda:

Fundamentación
Propósitos
Objetivos
Aprendizajes
Contenidos
Inicio
Desarrollo
Cierre
Actividades
Recursos
Evaluación
Criterios de evaluación
Cronograma

Si es PROYECTO, incluí cuando corresponda:

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

Si es RÚBRICA:

Presentá criterios de evaluación claros y niveles de logro.

La rúbrica debe ser fácil de copiar a Word y utilizar con estudiantes.

Respetá las indicaciones específicas del docente sobre extensión, organización, enfoque y formato.

Entregá únicamente el documento final.
`;
}

/* =========================================================
   LLAMADA A GEMINI
   ========================================================= */

async function llamarGemini(modelo, prompt, apiKey) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

  return await fetch(url, {
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
              text: prompt
            }
          ]
        }
      ],

      generationConfig: {
        maxOutputTokens: 6000
      }
    })
  });
}

/* =========================================================
   GENERACIÓN CON REINTENTOS Y MODELO ALTERNATIVO
   ========================================================= */

async function generarConGemini(prompt, apiKey) {

  const modelos = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
  ];

  let ultimoError = null;

  for (const modelo of modelos) {

    for (let intento = 1; intento <= 2; intento++) {

      try {

        const respuesta =
          await llamarGemini(
            modelo,
            prompt,
            apiKey
          );

        const datos =
          await respuesta.json();

        /* ÉXITO */
        if (respuesta.ok) {

          const texto =
            (
              datos?.candidates?.[0]?.content?.parts ||
              []
            )
              .map((parte) => parte.text || "")
              .join("")
              .trim();

          if (texto) {
            return {
              ok: true,
              texto,
              modelo
            };
          }

          ultimoError =
            "Gemini no devolvió contenido.";
        }

        /* SATURACIÓN / LÍMITE TEMPORAL */
        if (
          respuesta.status === 429 ||
          respuesta.status === 503
        ) {

          ultimoError =
            datos?.error?.message ||
            "El modelo está temporalmente saturado.";

          /*
           * Esperamos antes del segundo intento.
           * Primer intento: 2 segundos
           * Segundo intento: 4 segundos
           */

          if (intento < 2) {

            const espera =
              intento === 1
                ? 2000
                : 4000;

            await new Promise(
              (resolve) =>
                setTimeout(resolve, espera)
            );
          }

          continue;
        }

        /*
         * Otro error: no tiene sentido
         * seguir repitiendo la misma solicitud.
         */

        ultimoError =
          datos?.error?.message ||
          `Error de Gemini (${respuesta.status}).`;

        break;

      } catch (error) {

        ultimoError =
          error?.message ||
          "No se pudo conectar con Gemini.";

        if (intento < 2) {

          await new Promise(
            (resolve) =>
              setTimeout(resolve, 2000)
          );
        }
      }
    }
  }

  return {
    ok: false,
    error:
      ultimoError ||
      "Los modelos de Gemini no pudieron responder."
  };
}

/* =========================================================
   GENERAR DOCUMENTO
   ========================================================= */

app.post(
  "/api/generar",
  upload.array("materiales"),
  async (req, res) => {

    const data = req.body || {};

    /* Validación */
    if (!data.tipo || !data.tema) {

      return res.status(400).json({
        error:
          "Indicá al menos el tipo de trabajo y el tema."
      });
    }

    /* API KEY */
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {

      return res.status(503).json({
        error:
          "La IA no está configurada. Agregá GEMINI_API_KEY en Vercel."
      });
    }

    try {

      const materiales =
        req.files || [];

      const materialesProcesados = [];

      /* -----------------------------------------
         PROCESAR TODOS LOS MATERIALES
         ----------------------------------------- */

      for (const file of materiales) {

        try {

          const texto =
            await extraerTextoArchivo(file);

          if (
            texto &&
            texto.trim()
          ) {

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

      /* -----------------------------------------
         ARMAR CONTEXTO
         ----------------------------------------- */

      const materialesTexto =
        materialesProcesados
          .map((material) => {

            return `
--- MATERIAL DE REFERENCIA: ${material.nombre} ---

${material.texto}
`;

          })
          .join("\n\n");

      const datosParaPrompt = {
        ...data,
        materialesTexto
      };

      const prompt =
        buildPrompt(datosParaPrompt);

      /* -----------------------------------------
         GENERAR
         ----------------------------------------- */

      const resultado =
        await generarConGemini(
          prompt,
          apiKey
        );

      if (!resultado.ok) {

        console.error(
          "Gemini final error:",
          resultado.error
        );

        return res.status(502).json({
          error:
            "La IA está temporalmente ocupada. La aplicación está funcionando. Esperá unos segundos y probá nuevamente."
        });
      }

      /* -----------------------------------------
         LIMPIAR
         ----------------------------------------- */

      const textoFinal =
        limpiarResultado(
          resultado.texto
        );

      /* -----------------------------------------
         RESPUESTA
         ----------------------------------------- */

      return res.json({

        ok: true,

        texto: textoFinal,

        modelo:
          resultado.modelo,

        materialesUsados:
          materialesProcesados.map(
            (material) =>
              material.nombre
          )

      });

    } catch (error) {

      console.error(
        "Generation error:",
        error
      );

      return res.status(500).json({
        error:
          "No se pudo generar el trabajo. Revisá la configuración del servidor."
      });
    }
  }
);

/* =========================================================
   PÁGINA PRINCIPAL
   ========================================================= */

app.get("/", (_req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

/* =========================================================
   RUTAS RESTANTES
   ========================================================= */

app.get("*", (_req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

/* =========================================================
   EXPORTACIÓN PARA VERCEL
   ========================================================= */

module.exports = app;

/* =========================================================
   SERVIDOR LOCAL
   ========================================================= */

if (require.main === module) {

  const PORT =
    process.env.PORT || 3021;

  app.listen(
    PORT,
    () => {

      console.log(
        `Edu.sistem pro ia funcionando en http://localhost:${PORT}`
      );

    }
  );
}
