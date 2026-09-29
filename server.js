const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

const app = express();

const VERSION = "2.2";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(express.json({ limit: "4mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 12 * 1024 * 1024
  }
});


/* =========================================================
   24 JURISDICCIONES DE ARGENTINA
========================================================= */

const PROVINCIAS_ARGENTINAS = [
  { id: "buenos_aires", nombre: "Buenos Aires" },
  { id: "catamarca", nombre: "Catamarca" },
  { id: "chaco", nombre: "Chaco" },
  { id: "chubut", nombre: "Chubut" },
  {
    id: "ciudad_autonoma_de_buenos_aires",
    nombre: "Ciudad Autónoma de Buenos Aires"
  },
  { id: "cordoba", nombre: "Córdoba" },
  { id: "corrientes", nombre: "Corrientes" },
  { id: "entre_rios", nombre: "Entre Ríos" },
  { id: "formosa", nombre: "Formosa" },
  { id: "jujuy", nombre: "Jujuy" },
  { id: "la_pampa", nombre: "La Pampa" },
  { id: "la_rioja", nombre: "La Rioja" },
  { id: "mendoza", nombre: "Mendoza" },
  { id: "misiones", nombre: "Misiones" },
  { id: "neuquen", nombre: "Neuquén" },
  { id: "rio_negro", nombre: "Río Negro" },
  { id: "salta", nombre: "Salta" },
  { id: "san_juan", nombre: "San Juan" },
  { id: "san_luis", nombre: "San Luis" },
  { id: "santa_cruz", nombre: "Santa Cruz" },
  { id: "santa_fe", nombre: "Santa Fe" },
  { id: "santiago_del_estero", nombre: "Santiago del Estero" },
  {
    id: "tierra_del_fuego",
    nombre:
      "Tierra del Fuego, Antártida e Islas del Atlántico Sur"
  },
  { id: "tucuman", nombre: "Tucumán" }
];


/* =========================================================
   CATEGORÍAS
========================================================= */

const CATEGORIAS_BIBLIOTECA = [
  "Inicial",
  "Primaria",
  "Secundaria",
  "Superior",
  "Educación Especial",
  "Jóvenes y Adultos",
  "Educación Rural",
  "Educación Técnico Profesional",
  "Progresiones",
  "Aprendizajes y Contenidos Fundamentales",
  "Actualización curricular",
  "Referencias 2026"
];


/* =========================================================
   CARGAR BIBLIOTECA
========================================================= */

function loadLibrary() {

  try {

    const file =
      path.join(
        __dirname,
        "biblioteca.json"
      );

    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );

  } catch (error) {

    console.error(
      "Error cargando biblioteca.json:",
      error
    );

    return {
      version: VERSION,
      nombre:
        "Biblioteca Curricular Argentina",
      categorias:
        CATEGORIAS_BIBLIOTECA,
      provincias: {}
    };

  }

}


/* =========================================================
   CONVERTIR BIBLIOTECA A 24 JURISDICCIONES
========================================================= */

function getProvincias(library) {

  const datos =
    library &&
    library.provincias &&
    typeof library.provincias === "object"
      ? library.provincias
      : {};

  return PROVINCIAS_ARGENTINAS.map(
    provinciaBase => {

      const provincia =
        datos[provinciaBase.id] || {};

      return {

        id:
          provinciaBase.id,

        nombre:
          provincia.nombre ||
          provinciaBase.nombre,

        estado:
          "Disponible",

        nota:
          provincia.nota || "",

        documentos:
          Array.isArray(
            provincia.documentos
          )
            ? provincia.documentos
            : []

      };

    }
  );

}


/* =========================================================
   LIMPIAR TEXTO
========================================================= */

function cleanText(text) {

  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

}


/* =========================================================
   EXTRAER ARCHIVOS
========================================================= */

async function extractFile(file) {

  const ext =
    path.extname(
      file.originalname
    ).toLowerCase();


  if (ext === ".pdf") {

    const parsed =
      await pdfParse(
        file.buffer
      );

    return cleanText(
      parsed.text
    );

  }


  if (ext === ".docx") {

    const result =
      await mammoth.extractRawText({
        buffer:
          file.buffer
      });

    return cleanText(
      result.value
    );

  }


  if (
    [
      ".txt",
      ".md",
      ".csv",
      ".html",
      ".htm"
    ].includes(ext)
  ) {

    return cleanText(
      file.buffer
        .toString("utf8")
        .replace(
          /<[^>]*>/g,
          " "
        )
    );

  }


  return "";

}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    const library =
      loadLibrary();

    res.json({

      ok: true,

      app:
        "Edu.sistem pro ia",

      version:
        VERSION,

      geminiConfigured:
        Boolean(
          process.env.GEMINI_API_KEY
        ),

      model:
        MODEL,

      bibliotecaArgentina:
        true,

      provincias:
        PROVINCIAS_ARGENTINAS.length,

      jurisdicciones:
        24

    });

  }
);


/* =========================================================
   BIBLIOTECA
========================================================= */

app.get(
  "/api/biblioteca",
  (req, res) => {

    try {

      const library =
        loadLibrary();

      const provincias =
        getProvincias(
          library
        );


      const categorias =
        [
          ...new Set([
            ...CATEGORIAS_BIBLIOTECA,
            ...(Array.isArray(
              library.categorias
            )
              ? library.categorias
              : [])
          ])
        ];


      res.json({

        ok: true,

        version:
          library.version ||
          VERSION,

        nombre:
          library.nombre ||
          "Biblioteca Curricular Argentina",

        categorias,

        provincias

      });

    } catch (error) {

      console.error(
        "Error en /api/biblioteca:",
        error
      );

      res.status(500).json({

        ok: false,

        error:
          "No se pudo cargar la biblioteca curricular."

      });

    }

  }
);


/* =========================================================
   GENERAR
========================================================= */

app.post(
  "/api/generar",
  upload.array(
    "archivos",
    8
  ),
  async (
    req,
    res
  ) => {

    try {

      const apiKey =
        process.env.GEMINI_API_KEY;


      if (!apiKey) {

        return res
          .status(503)
          .json({

            ok: false,

            error:
              "GEMINI_API_KEY no está configurada en Vercel."

          });

      }


      const {

        tipo = "secuencia",

        provincia =
          "cordoba",

        nivel = "",

        grado = "",

        area = "",

        tema = "",

        duracion = "",

        indicaciones = "",

        categoriaBiblioteca = ""

      } =
        req.body || {};


      const library =
        loadLibrary();


      const provincias =
        getProvincias(
          library
        );


      const provinciaData =
        provincias.find(
          p =>
            p.id ===
            provincia
        ) || {

          id:
            provincia,

          nombre:
            provincia,

          documentos: []

        };


      /* ---------------------------------------------------
         DOCUMENTOS CURRICULARES
      --------------------------------------------------- */

      let documentos =
        Array.isArray(
          provinciaData.documentos
        )
          ? provinciaData.documentos
          : [];


      if (
        categoriaBiblioteca
      ) {

        documentos =
          documentos.filter(
            documento =>
              documento.categoria ===
              categoriaBiblioteca
          );

      }


      documentos =
        documentos.slice(
          0,
          12
        );


      /* ---------------------------------------------------
         MATERIALES DEL DOCENTE
      --------------------------------------------------- */

      const materiales = [];


      for (
        const file of
          req.files || []
      ) {

        try {

          const texto =
            await extractFile(
              file
            );


          if (texto) {

            materiales.push(
              `MATERIAL APORTADO POR EL DOCENTE: ${file.originalname}\n${texto.slice(
                0,
                50000
              )}`
            );

          }

        } catch (error) {

          console.error(
            "Error leyendo archivo:",
            file.originalname,
            error
          );

        }

      }


      /* ---------------------------------------------------
         REFERENCIAS OFICIALES
      --------------------------------------------------- */

      const documentosOficiales =
        documentos.length

          ? documentos
              .map(
                documento =>
                  `- ${documento.titulo || ""} (${documento.fuente || ""}) ${documento.url || ""}`
              )
              .join("\n")

          : "No hay documentos oficiales precargados para esta jurisdicción/categoría. No inventes citas ni documentos.";


      /* ---------------------------------------------------
         PROMPT
      --------------------------------------------------- */

      const prompt = `

Sos Edu.sistem Pro IA, un asistente pedagógico
para docentes de Argentina.

OBJETIVO:

Generar un ${tipo} claro, práctico y listo
para que un docente pueda revisar y utilizar
como base de trabajo.

DATOS DEL DOCENTE:

Provincia / jurisdicción:
${provinciaData.nombre}

Nivel:
${nivel}

Grado / Curso:
${grado}

Área / Materia:
${area}

Tema:
${tema}

Duración:
${duracion}

Indicaciones del docente:
${indicaciones}


BIBLIOTECA CURRICULAR ARGENTINA:

Jurisdicción seleccionada:
${provinciaData.nombre}

Referencias curriculares disponibles:

${documentosOficiales}


MATERIALES APORTADOS POR EL DOCENTE:

${
  materiales.length
    ? materiales.join("\n\n")
    : "No se adjuntaron materiales."
}


REGLAS:

- Adaptá la propuesta a la jurisdicción seleccionada.
- No atribuyas contenidos de una jurisdicción a otra.
- Utilizá las referencias oficiales proporcionadas cuando sean pertinentes.
- No inventes documentos oficiales.
- No inventes resoluciones ni números de normas.
- Si no hay documentación provincial disponible, trabajá con criterios pedagógicos generales y señalá brevemente que debe verificarse con el diseño curricular vigente.
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


      /* ---------------------------------------------------
         GEMINI
      --------------------------------------------------- */

      const ai =
        new GoogleGenAI({
          apiKey
        });


      const response =
        await ai.models.generateContent({

          model:
            MODEL,

          contents:
            prompt

        });


      const resultado =
        cleanText(
          response.text || ""
        );


      if (!resultado) {

        return res
          .status(502)
          .json({

            ok: false,

            error:
              "Gemini no devolvió contenido."

          });

      }


      res.json({

        ok: true,

        resultado,

        provincia:
          provinciaData.nombre,

        modelo:
          MODEL

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


/* =========================================================
   INDEX
========================================================= */

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


/* =========================================================
   LOGO
========================================================= */

app.get(
  "/logo.svg",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "logo.svg"
      )
    );

  }
);


/* =========================================================
   VERCEL
========================================================= */

module.exports =
  app;


/* =========================================================
   SERVIDOR LOCAL
========================================================= */

if (
  require.main ===
  module
) {

  const PORT =
    process.env.PORT ||
    3000;


  app.listen(
    PORT,
    () => {

      console.log(
        `Edu.sistem Pro IA ${VERSION} funcionando en puerto ${PORT}`
      );

    }
  );

}
