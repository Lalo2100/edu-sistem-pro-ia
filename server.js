const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();

/* =========================================================
   CONFIGURACIÓN
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
    version: "2.5",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    bibliotecaCordoba: true
  });
});

/* =========================================================
   BIBLIOTECA CURRICULAR CÓRDOBA
   ========================================================= */

const BIBLIOTECA = {
  inicial: "inicial",
  primaria: "primaria",
  secundaria: "secundaria",
  superior: "superior",
  especial: "especial",
  "jovenes-adultos": "jovenes-adultos",
  rural: "rural",
  "tecnico-profesional": "tecnico-profesional",
  progresiones: "progresiones",
  "aprendizajes-contenidos": "aprendizajes-contenidos",
  actualizacion: "actualizacion",
  "referencias-2026": "referencias-2026"
};

/* =========================================================
   LECTURA DE DOCUMENTOS DE LA BIBLIOTECA
   ========================================================= */

async function leerDocumentoBiblioteca(rutaArchivo) {
  try {
    const extension =
      path.extname(rutaArchivo).toLowerCase();

    const buffer =
      fs.readFileSync(rutaArchivo);

    if (extension === ".pdf") {
      const resultado =
        await pdfParse(buffer);

      return resultado.text || "";
    }

    if (extension === ".docx") {
      const resultado =
        await mammoth.extractRawText({
          buffer
        });

      return resultado.value || "";
    }

    return buffer.toString("utf8");

  } catch (error) {
    console.error(
      "Error leyendo documento de biblioteca:",
      rutaArchivo,
      error
    );

    return "";
  }
}

/* =========================================================
   CARGAR CATEGORÍAS SELECCIONADAS
   ========================================================= */

async function cargarBiblioteca(categorias) {

  if (!categorias) {
    return {
      texto: "",
      documentos: []
    };
  }

  let seleccionadas = [];

  try {

    if (Array.isArray(categorias)) {
      seleccionadas = categorias;
    } else if (typeof categorias === "string") {

      try {
        seleccionadas =
          JSON.parse(categorias);
      } catch {
        seleccionadas =
          categorias
            .split(",")
            .map(x => x.trim())
            .filter(Boolean);
      }
    }

  } catch {
    seleccionadas = [];
  }

  let textoTotal = "";
  const documentos = [];

  for (const categoria of seleccionadas) {

    const carpeta =
      BIBLIOTECA[categoria];

    if (!carpeta) {
      continue;
    }

    const rutaCarpeta =
      path.join(
        __dirname,
        "biblioteca",
        carpeta
      );

    if (!fs.existsSync(rutaCarpeta)) {
      continue;
    }

    let archivos = [];

    try {
      archivos =
        fs.readdirSync(rutaCarpeta);
    } catch {
      continue;
    }

    for (const archivo of archivos) {

      const extension =
        path.extname(archivo).toLowerCase();

      if (
        ![
          ".txt",
          ".md",
          ".pdf",
          ".docx"
        ].includes(extension)
      ) {
        continue;
      }

      const rutaArchivo =
        path.join(
          rutaCarpeta,
          archivo
        );

      const contenido =
        await leerDocumentoBiblioteca(
          rutaArchivo
        );

      if (!contenido.trim()) {
        continue;
      }

      /*
       * Para evitar que una biblioteca demasiado
       * grande supere el límite del prompt.
       */

      const contenidoLimitado =
        contenido.slice(0, 30000);

      textoTotal += `

==================================================
DOCUMENTO DE BIBLIOTECA CURRICULAR CÓRDOBA
==================================================

Categoría:
${categoria}

Documento:
${archivo}

Contenido:

${contenidoLimitado}

`;

      documentos.push(
        `${categoria} / ${archivo}`
      );

      /*
       * Límite global de seguridad.
       */

      if (textoTotal.length >= 100000) {
        return {
          texto:
            textoTotal.slice(0, 100000),
          documentos
        };
      }
    }
  }

  return {
    texto: textoTotal,
    documentos
  };
}

/* =========================================================
   LECTURA DE MATERIALES DEL DOCENTE
   ========================================================= */

async function extraerTextoArchivo(file) {

  const nombre =
    (file.originalname || "").toLowerCase();

  if (nombre.endsWith(".pdf")) {

    const resultado =
      await pdfParse(file.buffer);

    return resultado.text || "";
  }

  if (
    nombre.endsWith(".docx") ||
    nombre.endsWith(".doc")
  ) {

    const resultado =
      await mammoth.extractRawText({
        buffer: file.buffer
      });

    return resultado.value || "";
  }

  return file.buffer.toString("utf8");
}

/* =========================================================
   LIMPIEZA DEL RESULTADO
   ========================================================= */

function limpiarResultado(texto) {

  if (!texto) {
    return "";
  }

  let salida = texto;

  salida =
    salida.replace(
      /^#{1,6}\s*/gm,
      ""
    );

  salida =
    salida.replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    );

  salida =
    salida.replace(
      /\*(.*?)\*/g,
      "$1"
    );

  salida =
    salida.replace(
      /^\s*[-*]\s+/gm,
      "• "
    );

  salida =
    salida.replace(
      /^\s*>\s?/gm,
      ""
    );

  salida =
    salida.replace(
      /^\s*[-*_]{3,}\s*$/gm,
      ""
    );

  salida =
    salida.replace(
      /\n{3,}/g,
      "\n\n"
    );

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
  materialesTexto,
  bibliotecaTexto
}) {

  const nombres = {

    anual:
      "PLANIFICACIÓN ANUAL",

    secuencia:
      "SECUENCIA DIDÁCTICA",

    proyecto:
      "PROYECTO",

    rubrica:
      "RÚBRICA"

  };

  const tipoTrabajo =
    nombres[tipo] ||
    "PROPUESTA DOCENTE";

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

Si indica solamente una cantidad de semanas pero no indica cantidad de clases o módulos, organizá la propuesta de manera razonable y explicitá la cantidad utilizada.

Si la duración está expresada en horas cátedra, respetá esa cantidad.

Si la duración aparece dentro de las indicaciones del docente, también debe respetarse.

==================================================
BIBLIOTECA CURRICULAR CÓRDOBA
==================================================

Los documentos incluidos en la Biblioteca Curricular Córdoba son materiales de referencia.

Utilizalos cuando sean pertinentes para seleccionar:

• aprendizajes
• contenidos
• ejes
• objetivos
• propósitos
• orientaciones pedagógicas
• criterios de evaluación
• organización de la enseñanza

No inventes normativa oficial.

No inventes resoluciones, citas, páginas ni documentos.

No atribuyas a un documento información que no aparece en su contenido.

La biblioteca es una fuente de referencia y no debe reemplazar las indicaciones específicas del docente.

==================================================
MATERIALES DEL DOCENTE
==================================================

Los materiales proporcionados por el docente también son fuentes de referencia.

Analizalos y utilizalos cuando sean pertinentes.

No te limites a copiar los materiales.

Transformá sus contenidos en objetivos, actividades, estrategias y criterios de evaluación cuando corresponda.

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

==================================================
BIBLIOTECA CURRICULAR SELECCIONADA
==================================================

${bibliotecaTexto || "No se seleccionaron documentos de la Biblioteca Curricular Córdoba."}

==================================================
MATERIALES DE REFERENCIA DEL DOCENTE
==================================================

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
CONTROL FINAL
==================================================

Antes de entregar verificá internamente:

1. Tipo de trabajo.
2. Nivel.
3. Grado o curso.
4. Área o materia.
5. Tema.
6. Duración.
7. Cantidad de semanas.
8. Cantidad de clases o módulos.
9. Integración pertinente de los materiales.
10. Coherencia entre cronograma y desarrollo.
11. Ausencia de clases adicionales.
12. Ausencia de clases faltantes.

No muestres este control.

Entregá solamente el documento final.

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

Cada clase o módulo debe aparecer identificado claramente.

Si se solicita una cantidad exacta de módulos, desarrollá todos los módulos individualmente.

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

Respetá las indicaciones específicas del docente.

Entregá únicamente el documento final.
`;
}

/* =========================================================
   GEMINI
   ========================================================= */

async function llamarGemini(
  modelo,
  prompt,
  apiKey
) {

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

  return await fetch(
    url,
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
}

/* =========================================================
   GEMINI CON REINTENTOS
   ========================================================= */

async function generarConGemini(
  prompt,
  apiKey
) {

  const modelos = [

    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"

  ];

  let ultimoError = null;

  for (
    const modelo of modelos
  ) {

    for (
      let intento = 1;
      intento <= 2;
      intento++
    ) {

      try {

        const respuesta =
          await llamarGemini(
            modelo,
            prompt,
            apiKey
          );

        const datos =
          await respuesta.json();

        if (respuesta.ok) {

          const texto =
            (
              datos?.candidates?.[0]?.content?.parts ||
              []
            )
              .map(
                parte =>
                  parte.text || ""
              )
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
              resolve =>
                setTimeout(
                  resolve,
                  espera
                )
            );

            continue;
          }

          break;
        }

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
            resolve =>
              setTimeout(
                resolve,
                2000
              )
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

    const data =
      req.body || {};

    if (
      !data.tipo ||
      !data.tema
    ) {

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

      /* -----------------------------------------------------
         MATERIALES DEL DOCENTE
         ----------------------------------------------------- */

      const materiales =
        req.files || [];

      const materialesProcesados =
        [];

      for (
        const file of materiales
      ) {

        try {

          const texto =
            await extraerTextoArchivo(
              file
            );

          if (
            texto &&
            texto.trim()
          ) {

            materialesProcesados.push({
              nombre:
                file.originalname,

              texto:
                texto.trim()
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
            material => `
--- MATERIAL DEL DOCENTE: ${material.nombre} ---

${material.texto}
`
          )
          .join("\n\n")
          .slice(0, 60000);

      /* -----------------------------------------------------
         BIBLIOTECA
         ----------------------------------------------------- */

      const categorias =
        data.bibliotecaCategorias ||
        data.biblioteca;

      const biblioteca =
        await cargarBiblioteca(
          categorias
        );

      /* -----------------------------------------------------
         PROMPT
         ----------------------------------------------------- */

      const prompt =
        buildPrompt({

          ...data,

          materialesTexto,

          bibliotecaTexto:
            biblioteca.texto

        });

      /* -----------------------------------------------------
         GEMINI
         ----------------------------------------------------- */

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

        texto:
          textoFinal,

        modelo:
          resultado.modelo,

        bibliotecaUsada:
          biblioteca.documentos,

        materialesUsados:
          materialesProcesados.map(
            material =>
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

app.get(
  "/",
  (_req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);

/* =========================================================
   RUTAS RESTANTES
   ========================================================= */

app.get(
  "*",
  (_req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);

/* =========================================================
   VERCEL
   ========================================================= */

module.exports = app;

/* =========================================================
   SERVIDOR LOCAL
   ========================================================= */

if (
  require.main === module
) {

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
