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
    version: "1.2",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

/* =========================================================
   LECTURA DE MATERIALES
   ========================================================= */

async function extraerTextoArchivo(file) {
  const nombre = (file.originalname || "").toLowerCase();

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

/* =========================================================
   LIMPIEZA DEL TEXTO GENERADO
   ========================================================= */

function limpiarResultado(texto) {
  if (!texto) return "";

  let salida = texto;

  salida = salida.replace(/^#{1,6}\s*/gm, "");
  salida = salida.replace(/\*\*(.*?)\*\*/g, "$1");
  salida = salida.replace(/\*(.*?)\*/g, "$1");
  salida = salida.replace(/^\s*[-*]\s+/gm, "• ");
  salida = salida.replace(/^\s*>\s?/gm, "");
  salida = salida.replace(/^\s*[-*_]{3,}\s*$/gm, "");
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

==================================================
REGLA PRIORITARIA: RESPETAR LA DURACIÓN
==================================================

La duración indicada por el docente es una RESTRICCIÓN OBLIGATORIA.

No cambies, reduzcas ni aumentes la cantidad de semanas, clases, módulos, horas o encuentros indicados.

Si el docente indica una cantidad concreta de semanas y una cantidad concreta de módulos por semana, debés generar exactamente esa cantidad.

Ejemplo:

Si indica:
4 semanas
4 módulos por semana
80 minutos por módulo

Debés generar exactamente:

Semana 1: 4 módulos
Semana 2: 4 módulos
Semana 3: 4 módulos
Semana 4: 4 módulos

TOTAL: 16 módulos.

No generes 12 módulos.
No generes 3 clases por semana.
No agregues ni elimines encuentros.

Si el docente indica solamente una cantidad de semanas pero no indica cantidad de clases o módulos, organizá la propuesta de manera razonable y explicitá la cantidad utilizada.

Si la duración está expresada en horas cátedra, respetá esa cantidad.

Si la duración aparece dentro de las indicaciones del docente, también debe respetarse.

La duración tiene prioridad sobre una organización genérica aprendida previamente.

==================================================
MATERIALES DE REFERENCIA
==================================================

Los materiales proporcionados por el docente son fuentes de referencia.

Si se adjunta un Diseño Curricular, programa, documento institucional u otro material pedagógico, analizá su contenido y utilizalo para fundamentar y seleccionar aprendizajes, contenidos, objetivos, ejes, criterios y actividades cuando corresponda.

Los contenidos del material deben integrarse de manera coherente en la propuesta.

No te limites a copiar el material.

Transformá sus contenidos en objetivos, actividades, estrategias y criterios de evaluación cuando corresponda.

No inventes información que contradiga los materiales proporcionados.

No inventes citas, páginas, resoluciones, documentos oficiales ni referencias que no aparezcan en los materiales o que no sean necesarias.

==================================================
DATOS DEL TRABAJO
==================================================

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

==================================================
REGLAS DE PRESENTACIÓN
==================================================

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

==================================================
CONTROL FINAL OBLIGATORIO
==================================================

Antes de entregar el documento verificá internamente:

1. Que el tipo de trabajo coincida con el solicitado.
2. Que el nivel, grado y área coincidan con los datos proporcionados.
3. Que el tema sea el solicitado.
4. Que la duración sea respetada exactamente.
5. Que la cantidad de semanas coincida.
6. Que la cantidad de clases o módulos coincida.
7. Que los contenidos del material de referencia estén realmente integrados.
8. Que no haya contradicciones entre el cronograma y el desarrollo de actividades.
9. Que el cronograma tenga la misma cantidad de encuentros que el desarrollo.
10. Que no aparezcan clases adicionales ni falten clases.

No muestres este control al docente. Entregá solamente el documento final.

==================================================
TIPO DE DOCUMENTO
==================================================

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

IMPORTANTE:

En una secuencia didáctica, cada clase o módulo debe aparecer identificado de forma clara.

Si se solicita una cantidad exacta de módulos, desarrollá todos los módulos individualmente.

No agrupes varios módulos bajo una sola clase cuando el docente haya solicitado una cantidad exacta.

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
Cronograma

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
   GENERACIÓN CON REINTENTOS Y MODELOS ALTERNATIVOS
   ========================================================= */

async function generarConGemini(prompt, apiKey) {

  const modelos = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
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

          break;
        }

        /* 429 / 503 */
        if (
          respuesta.status === 429 ||
          respuesta.status === 503
        ) {

          ultimoError =
            datos?.error?.message ||
            "El modelo está temporalmente saturado.";

          if (intento < 2) {

            const espera =
              intento === 1
                ? 2000
                : 4000;

            await new Promise(
              (resolve) =>
                setTimeout(resolve, espera)
            );

            continue;
          }

          break;
        }

        /* OTROS ERRORES */

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

    if (!data.tipo || !data.tema) {

      return res.status(400).json({
        error:
          "Indicá al menos el tipo de trabajo y el tema."
      });
    }

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

      const textoFinal =
        limpiarResultado(
          resultado.texto
        );

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
