const express = require("express");
const path = require("path");
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
    version: "2.6",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    bibliotecaCordoba: true
  });
});

/* =========================================================
   BIBLIOTECA CURRICULAR CÓRDOBA
   FUENTES OFICIALES
   ========================================================= */

const BIBLIOTECA_CORDOBA = {

  "marco-curricular": {
    nombre: "Marco Curricular Común",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/MARCO%20CURRICULAR%20COMUN.pdf"
    ]
  },

  "inicial": {
    nombre: "Educación Inicial",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/ORIENTACIONES%20PEDAGOGICAS%20Y%20DIDACTICAS%20%20EDUCACION%20INICIAL.pdf"
    ]
  },

  "primaria": {
    nombre: "Educación Primaria",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/EDUCACION%20PRIMARIA%20-%20ORIENTACIONES%20PEDAGOGICAS%20Y%20DIDACTICAS.pdf"
    ]
  },

  "secundaria": {
    nombre: "Educación Secundaria",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/EDUCACION%20SECUNDARIA%20-%20ORIENTACIONES%20PEDAGOGICAS%20Y%20DIDACTICAS.pdf"
    ]
  },

  "progresiones-inicial": {
    nombre: "Progresiones de Aprendizaje — Educación Inicial",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/PdA-EDUCACION%20INICIAL.pdf"
    ]
  },

  "progresiones-primaria": {
    nombre: "Progresiones de Aprendizaje — Educación Primaria",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/PdA-EDUCACION%20PRIMARIA.pdf"
    ]
  },

  "progresiones-secundaria": {
    nombre: "Progresiones de Aprendizaje — Educación Secundaria",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/PdA-EDUCACION%20SECUNDARIA.pdf"
    ]
  },

  "progresiones-lengua": {
    nombre: "Progresiones — Lenguaje/Lengua y Literatura",
    urls: [
      "https://www.curriculumcordoba.ar/downloads/PROGRESIONES%20DE%20APRENDIZAJE%20DE%20LENGUAJE-LENGUA%20Y%20LITERATURA.pdf"
    ]
  }

};

/* =========================================================
   NORMALIZACIÓN DE CATEGORÍAS
   ========================================================= */

function normalizarCategoria(valor) {

  if (!valor) return "";

  const texto =
    String(valor)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/_/g, "-")
      .replace(/\s+/g, "-");

  const equivalencias = {

    "inicial":
      "inicial",

    "educacion-inicial":
      "inicial",

    "primaria":
      "primaria",

    "educacion-primaria":
      "primaria",

    "secundaria":
      "secundaria",

    "educacion-secundaria":
      "secundaria",

    "superior":
      "superior",

    "especial":
      "especial",

    "educacion-especial":
      "especial",

    "jovenes-adultos":
      "jovenes-adultos",

    "jovenes-y-adultos":
      "jovenes-adultos",

    "rural":
      "rural",

    "educacion-rural":
      "rural",

    "tecnico-profesional":
      "tecnico-profesional",

    "tecnico-profesional":
      "tecnico-profesional",

    "progresiones":
      "progresiones-inicial",

    "progresiones-inicial":
      "progresiones-inicial",

    "progresiones-primaria":
      "progresiones-primaria",

    "progresiones-secundaria":
      "progresiones-secundaria",

    "aprendizajes-contenidos":
      "progresiones-inicial",

    "actualizacion":
      "marco-curricular",

    "referencias-2026":
      "marco-curricular",

    "marco-curricular":
      "marco-curricular",

    "marco-curricular-comun":
      "marco-curricular"
  };

  return equivalencias[texto] || texto;
}

/* =========================================================
   OBTENER CATEGORÍAS SELECCIONADAS
   ========================================================= */

function obtenerCategorias(valor) {

  if (!valor) return [];

  if (Array.isArray(valor)) {
    return valor
      .map(normalizarCategoria)
      .filter(Boolean);
  }

  if (typeof valor === "string") {

    try {

      const parsed =
        JSON.parse(valor);

      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizarCategoria)
          .filter(Boolean);
      }

    } catch (_) {}

    return valor
      .split(",")
      .map(normalizarCategoria)
      .filter(Boolean);
  }

  return [];
}

/* =========================================================
   DESCARGAR DOCUMENTO OFICIAL
   ========================================================= */

async function descargarPDF(url) {

  const respuesta =
    await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Edu.sistem Pro IA"
      }
    });

  if (!respuesta.ok) {

    throw new Error(
      `No se pudo obtener el documento (${respuesta.status})`
    );
  }

  const buffer =
    Buffer.from(
      await respuesta.arrayBuffer()
    );

  return buffer;
}

/* =========================================================
   EXTRAER TEXTO DEL PDF OFICIAL
   ========================================================= */

async function extraerPDFRemoto(url) {

  const buffer =
    await descargarPDF(url);

  const resultado =
    await pdfParse(buffer);

  return resultado.text || "";
}

/* =========================================================
   CARGAR BIBLIOTECA CURRICULAR
   ========================================================= */

async function cargarBibliotecaCordoba(
  categorias
) {

  const seleccionadas =
    obtenerCategorias(categorias);

  let textoTotal = "";

  const documentosUsados = [];

  const categoriasNoDisponibles = [];

  for (
    const categoria
    of seleccionadas
  ) {

    const documento =
      BIBLIOTECA_CORDOBA[
        categoria
      ];

    if (!documento) {

      categoriasNoDisponibles.push(
        categoria
      );

      continue;
    }

    for (
      const url
      of documento.urls
    ) {

      try {

        const texto =
          await extraerPDFRemoto(
            url
          );

        if (!texto.trim()) {
          continue;
        }

        /*
         * Límite por documento.
         * Evita prompts gigantes.
         */

        const contenido =
          texto.slice(
            0,
            35000
          );

        textoTotal += `

==================================================
BIBLIOTECA CURRICULAR CÓRDOBA
==================================================

Documento:
${documento.nombre}

Fuente oficial:
Currículum Córdoba

Contenido de referencia:

${contenido}

==================================================
`;

        documentosUsados.push(
          documento.nombre
        );

        /*
         * Límite global de seguridad.
         */

        if (
          textoTotal.length >= 90000
        ) {

          return {
            texto:
              textoTotal.slice(
                0,
                90000
              ),

            documentos:
              [...new Set(
                documentosUsados
              )],

            categoriasNoDisponibles
          };
        }

      } catch (error) {

        console.error(
          "Error obteniendo documento curricular:",
          documento.nombre,
          error.message
        );

      }
    }
  }

  return {
    texto:
      textoTotal,

    documentos:
      [...new Set(
        documentosUsados
      )],

    categoriasNoDisponibles
  };
}

/* =========================================================
   LECTURA DE MATERIALES DEL DOCENTE
   ========================================================= */

async function extraerTextoArchivo(
  file
) {

  const nombre =
    (
      file.originalname ||
      ""
    ).toLowerCase();

  if (
    nombre.endsWith(".pdf")
  ) {

    const resultado =
      await pdfParse(
        file.buffer
      );

    return resultado.text || "";
  }

  if (
    nombre.endsWith(".docx") ||
    nombre.endsWith(".doc")
  ) {

    const resultado =
      await mammoth.extractRawText({
        buffer:
          file.buffer
      });

    return resultado.value || "";
  }

  return file.buffer.toString(
    "utf8"
  );
}

/* =========================================================
   LIMPIEZA DEL RESULTADO
   ========================================================= */

function limpiarResultado(
  texto
) {

  if (!texto) return "";

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
REGLA PRIORITARIA: DURACIÓN
==================================================

La duración indicada por el docente es obligatoria.

No cambies, reduzcas ni aumentes la cantidad de semanas, clases, módulos, horas o encuentros.

Si el docente indica:

4 semanas
4 módulos por semana

deben aparecer exactamente:

Semana 1: 4 módulos
Semana 2: 4 módulos
Semana 3: 4 módulos
Semana 4: 4 módulos

TOTAL: 16 módulos.

No agregues encuentros que el docente no solicitó.

==================================================
BIBLIOTECA CURRICULAR CÓRDOBA
==================================================

Los documentos incluidos en esta sección provienen de las fuentes oficiales publicadas por Currículum Córdoba.

Utilizalos como material de referencia.

Cuando sea pertinente, utilizalos para seleccionar:

• aprendizajes
• contenidos
• ejes
• objetivos
• propósitos
• orientaciones pedagógicas
• criterios de evaluación
• indicadores de logro
• organización de la enseñanza

No inventes normativa.

No inventes resoluciones.

No inventes citas.

No atribuyas a los documentos información que no aparece en ellos.

La biblioteca debe complementar las indicaciones del docente.

==================================================
CONTENIDO CURRICULAR SELECCIONADO
==================================================

${bibliotecaTexto || "No se seleccionó documentación curricular."}

==================================================
MATERIALES DEL DOCENTE
==================================================

Los materiales que cargue el docente también son fuentes de referencia.

Analizalos cuando sean pertinentes.

No te limites a copiarlos.

Transformá la información relevante en:

• objetivos
• aprendizajes
• contenidos
• actividades
• estrategias
• evaluación
• criterios

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
MATERIALES DE REFERENCIA DEL DOCENTE
==================================================

${materialesTexto || "No se adjuntaron materiales."}

==================================================
PRESENTACIÓN
==================================================

Entregá directamente el documento final.

No expliques cómo funciona la IA.

No menciones este prompt.

No utilices Markdown.

No utilices:

#
##
###
**
***

Usá títulos claros escritos normalmente.

Usá subtítulos claros.

Usá viñetas cuando corresponda.

El documento debe poder copiarse directamente a Word.

==================================================
CONTROL FINAL
==================================================

Antes de entregar verificá:

1. Tipo de trabajo.
2. Nivel.
3. Grado o curso.
4. Área.
5. Tema.
6. Duración.
7. Cantidad de semanas.
8. Cantidad de clases.
9. Cantidad de módulos.
10. Integración de los materiales pertinentes.
11. Coherencia del cronograma.
12. Ausencia de clases faltantes.
13. Ausencia de clases adicionales.

No muestres este control.

Entregá solamente el documento final.

==================================================
TIPO DE DOCUMENTO
==================================================

PLANIFICACIÓN ANUAL:

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

SECUENCIA DIDÁCTICA:

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

Cada clase o módulo debe estar identificado claramente.

PROYECTO:

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

RÚBRICA:

Presentá criterios claros y niveles de logro.

Debe ser fácil de copiar a Word y utilizar con estudiantes.

Entregá únicamente el documento final.
`;
}

/* =========================================================
   LLAMADA A GEMINI
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
        "Content-Type":
          "application/json",

        "x-goog-api-key":
          apiKey
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
          maxOutputTokens:
            10000
        }

      })
    }
  );
}

/* =========================================================
   GENERACIÓN CON GEMINI
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

  let ultimoError =
    null;

  for (
    const modelo
    of modelos
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

        if (
          respuesta.ok
        ) {

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

          if (
            intento < 2
          ) {

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  intento === 1
                    ? 2000
                    : 4000
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

        if (
          intento < 2
        ) {

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
   API GENERAR
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
        const file
        of materiales
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
          .slice(
            0,
            60000
          );

      /* -----------------------------------------------------
         BIBLIOTECA
         ----------------------------------------------------- */

      const categorias =
        data.bibliotecaCategorias ||
        data.biblioteca;

      const biblioteca =
        await cargarBibliotecaCordoba(
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

      if (
        !resultado.ok
      ) {

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
          ),

        categoriasBibliotecaNoDisponibles:
          biblioteca.categoriasNoDisponibles

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
