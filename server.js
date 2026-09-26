const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2,
    fileSize: 2 * 1024 * 1024
  }
});

/* ================================
   BIBLIOTECA CÓRDOBA
================================ */

const bibliotecaPath = path.join(
  __dirname,
  "biblioteca-cordoba.json"
);

let biblioteca = {
  categorias: {}
};

try {
  biblioteca = JSON.parse(
    fs.readFileSync(bibliotecaPath, "utf8")
  );

  console.log(
    "Biblioteca Córdoba cargada."
  );
} catch (error) {
  console.error(
    "Error cargando biblioteca-cordoba.json:",
    error.message
  );
}

/* ================================
   MODELOS GEMINI
================================ */

const MODELS = (
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash-lite,gemini-3.5-flash"
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

/* ================================
   LIMPIAR RESULTADO
================================ */

function limpiarResultado(texto) {
  return String(texto || "")
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

/* ================================
   LEER ARCHIVOS
================================ */

async function extraerTextoArchivo(file) {
  const name = (
    file.originalname || ""
  ).toLowerCase();

  if (name.endsWith(".pdf")) {
    const resultado =
      await pdfParse(file.buffer);

    return resultado.text || "";
  }

  if (name.endsWith(".docx")) {
    const resultado =
      await mammoth.extractRawText({
        buffer: file.buffer
      });

    return resultado.value || "";
  }

  if (
    /\.(txt|md|csv|html|htm)$/.test(name)
  ) {
    return file.buffer
      .toString("utf8")
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      );
  }

  throw new Error(
    "Formato no compatible: " +
      file.originalname
  );
}

/* ================================
   BUSCAR CATEGORÍA
================================ */

function buscarCategoria(categoria) {
  const categorias =
    biblioteca.categorias || {};

  if (categorias[categoria]) {
    return {
      nombre: categoria,
      item: categorias[categoria]
    };
  }

  if (
    categoria ===
      "Técnico Profesional" &&
    categorias[
      "Educación Técnico Profesional"
    ]
  ) {
    return {
      nombre:
        "Educación Técnico Profesional",
      item:
        categorias[
          "Educación Técnico Profesional"
        ]
    };
  }

  if (
    categoria ===
      "Educación Técnico Profesional" &&
    categorias[
      "Técnico Profesional"
    ]
  ) {
    return {
      nombre:
        "Técnico Profesional",
      item:
        categorias[
          "Técnico Profesional"
        ]
    };
  }

  return null;
}

/* ================================
   OBTENER BIBLIOTECA
================================ */

function obtenerBibliotecaLocal(
  categorias
) {
  const seleccionadas =
    Array.isArray(categorias)
      ? categorias
      : [];

  const usadas = [];
  const noEncontradas = [];
  const bloques = [];

  for (
    const categoria of seleccionadas
  ) {
    const encontrado =
      buscarCategoria(categoria);

    if (!encontrado) {
      noEncontradas.push(
        categoria
      );
      continue;
    }

    usadas.push(categoria);

    const item =
      encontrado.item || {};

    bloques.push(
      [
        "REFERENCIA LOCAL:",
        categoria,
        "Nombre en biblioteca:",
        encontrado.nombre,
        "Estado:",
        item.estado ||
          "referencia",
        "Contenido:",
        item.contenido || ""
      ].join("\n")
    );
  }

  return {
    seleccionadas,
    usadas,
    noEncontradas,
    texto:
      bloques.join("\n\n")
  };
}

/* ================================
   PROMPT
================================ */

function buildPrompt(
  data,
  materiales,
  bibliotecaInfo
) {
  const tipo =
    String(
      data.tipo || ""
    ).trim();

  const nivel =
    String(
      data.nivel || ""
    ).trim();

  const grado =
    String(
      data.grado || ""
    ).trim();

  const area =
    String(
      data.area || ""
    ).trim();

  const tema =
    String(
      data.tema || ""
    ).trim();

  const duracion =
    String(
      data.duracion || ""
    ).trim();

  const indicaciones =
    String(
      data.indicaciones || ""
    ).trim();

  const seleccionadas =
    bibliotecaInfo
      .seleccionadas || [];

  const bibliotecaTexto =
    bibliotecaInfo.texto || "";

  return `
EDU.SISTEM PRO IA

Generá un documento educativo profesional para docentes argentinos.

DATOS FIJOS DEL DOCENTE

TIPO DE TRABAJO:
${tipo || "No indicado"}

NIVEL:
${nivel || "No indicado"}

GRADO / CURSO:
${grado || "No indicado"}

ÁREA / MATERIA:
${area || "No indicada"}

TEMA:
${tema || "No indicado"}

DURACIÓN:
${duracion || "No indicada"}

AÑO DE REFERENCIA:
2026

INDICACIONES DEL DOCENTE:
${
  indicaciones ||
  "Propuesta completa y adecuada al nivel indicado."
}


BIBLIOTECA CURRICULAR CÓRDOBA

CATEGORÍAS SELECCIONADAS:

${
  seleccionadas.length
    ? seleccionadas
        .map(
          (c, i) =>
            `${i + 1}. ${c}`
        )
        .join("\n")
    : "Ninguna"
}

CONTENIDO DE LA BIBLIOTECA:

${
  bibliotecaTexto ||
  "No hay contenido local para las categorías seleccionadas."
}


MATERIALES DEL DOCENTE:

${
  materiales ||
  "No se enviaron materiales adicionales."
}


REGLAS OBLIGATORIAS

1. Respetá exactamente el nivel indicado.

2. Respetá exactamente el grado o curso indicado.

3. Respetá exactamente el área o materia indicada.

4. Respetá exactamente el tema indicado.

5. Respetá la duración indicada.

6. Respetá el tipo de trabajo solicitado.

7. Usá 2026 como año de referencia.

8. Utilizá las categorías de la Biblioteca Curricular Córdoba seleccionadas por el docente cuando exista contenido disponible.

9. No inventes documentos oficiales, resoluciones, leyes ni contenidos curriculares que no estén presentes en las referencias recibidas.

10. Si el docente aportó materiales, utilizalos como referencia cuando sean pertinentes.

11. No cambies el nivel, grado, área, tema, duración o tipo de trabajo.

12. No mezcles niveles educativos innecesariamente.

13. Los objetivos, contenidos, actividades y evaluación deben ser coherentes con el nivel, grado, área y tema.

14. No consultes Internet para completar la Biblioteca Curricular Córdoba.

15. No digas que sos una IA.

16. No expliques el proceso de generación.

17. Entregá directamente el documento terminado.

18. No utilices Markdown visible.

19. No uses símbolos como **, # o \`\`\`.

20. El resultado debe quedar limpio y listo para copiar a Word.


VERIFICACIÓN FINAL

Antes de entregar el documento comprobá:

Nivel correcto.
Grado o curso correcto.
Área correcta.
Tema correcto.
Duración correcta.
Tipo de trabajo correcto.
Año 2026.
Categorías de biblioteca respetadas.
Materiales del docente considerados.
Sin normativa inventada.


GENERÁ AHORA EL DOCUMENTO FINAL.
`;
}

/* ================================
   LLAMAR GEMINI
================================ */

async function llamarGemini(
  modelo,
  prompt
) {
  const key =
    process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error(
      "GEMINI_API_KEY no configurada."
    );
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(modelo) +
    ":generateContent";

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            key
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
            temperature: 0.2
          }
        })
      }
    );

  const raw =
    await response.text();

  let json = {};

  try {
    json =
      JSON.parse(raw);
  } catch (_) {}

  if (!response.ok) {
    const error =
      new Error(
        json?.error?.message ||
          `Gemini HTTP ${response.status}`
      );

    error.status =
      response.status;

    throw error;
  }

  return (
    json?.candidates?.[0]
      ?.content?.parts
      ?.map(
        part =>
          part.text || ""
      )
      .join("") || ""
  );
}

/* ================================
   GENERAR CON GEMINI
================================ */

async function generarConGemini(
  prompt
) {
  let ultimoError;

  for (
    const modelo of MODELS
  ) {
    try {
      console.log(
        "Probando modelo:",
        modelo
      );

      const texto =
        await llamarGemini(
          modelo,
          prompt
        );

      return {
        texto:
          limpiarResultado(
            texto
          ),

        modelo
      };

    } catch (error) {

      console.error(
        "Error con modelo:",
        modelo,
        error.message
      );

      ultimoError =
        error;
    }
  }

  throw (
    ultimoError ||
    new Error(
      "No fue posible generar el documento."
    )
  );
}

/* ================================
   HEALTH
================================ */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok: true,

      app:
        "Edu.sistem pro ia",

      version:
        "3.2-local",

      geminiConfigured:
        !!process.env.GEMINI_API_KEY,

      bibliotecaCordoba:
        true,

      bibliotecaModo:
        "local",

      categoriasBiblioteca:
        Object.keys(
          biblioteca.categorias ||
            {}
        )
    });
  }
);

/* ================================
   GENERAR
================================ */

app.post(
  "/api/generar",

  upload.array(
    "materiales",
    2
  ),

  async (
    req,
    res
  ) => {

    try {

      const categoriasRaw =
        req.body
          .bibliotecaCategorias;

      const categorias =
        Array.isArray(
          categoriasRaw
        )
          ? categoriasRaw
          : categoriasRaw
            ? [categoriasRaw]
            : [];

      const bibliotecaLocal =
        obtenerBibliotecaLocal(
          categorias
        );

      const partesMateriales =
        [];

      const materialesUsados =
        [];

      for (
        const file of
          req.files || []
      ) {

        const texto =
          (
            await extraerTextoArchivo(
              file
            )
          ).slice(
            0,
            20000
          );

        partesMateriales.push(
          `MATERIAL DEL DOCENTE — ${file.originalname}\n${texto}`
        );

        materialesUsados.push(
          file.originalname
        );
      }

      const prompt =
        buildPrompt(
          req.body,

          partesMateriales.join(
            "\n\n"
          ),

          bibliotecaLocal
        );

      const resultado =
        await generarConGemini(
          prompt
        );

      res.json({

        ok: true,

        texto:
          resultado.texto,

        modelo:
          resultado.modelo,

        materialesUsados,

        bibliotecaSeleccionada:
          bibliotecaLocal
            .seleccionadas,

        bibliotecaUsada:
          bibliotecaLocal.usadas,

        bibliotecaNoEncontrada:
          bibliotecaLocal
            .noEncontradas,

        bibliotecaModo:
          "local",

        anioReferencia:
          2026
      });

    } catch (error) {

      console.error(
        "Error /api/generar:",
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message ||
          "Error de generación"

      });
    }
  }
);

/* ================================
   INDEX
================================ */

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

/* ================================
   RUTA GENERAL
================================ */

app.use(
  (req, res, next) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

/* ================================
   SERVIDOR
================================ */

if (
  require.main === module
) {

  app.listen(
    PORT,
    () => {

      console.log(
        `Edu.sistem Pro IA en puerto ${PORT}`
      );

    }
  );
}

module.exports = app;
