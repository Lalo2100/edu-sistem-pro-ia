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

/* =========================================================
   BIBLIOTECA CURRICULAR CÓRDOBA
   ========================================================= */

const bibliotecaPath = path.join(__dirname, "biblioteca-cordoba.json");

let biblioteca = {
  categorias: {}
};

try {
  biblioteca = JSON.parse(
    fs.readFileSync(bibliotecaPath, "utf8")
  );

  console.log(
    "Biblioteca Córdoba cargada:",
    Object.keys(biblioteca.categorias || {})
  );
} catch (e) {
  console.error(
    "No se pudo cargar biblioteca-cordoba.json:",
    e.message
  );
}

/*
  Algunas versiones del HTML pueden enviar
  "Técnico Profesional", mientras que la biblioteca
  puede tener "Educación Técnico Profesional".

  Se contemplan ambas formas sin modificar el HTML.
*/
const ALIAS_CATEGORIAS = {
  "Técnico Profesional": [
    "Técnico Profesional",
    "Educación Técnico Profesional"
  ],

  "Educación Técnico Profesional": [
    "Educación Técnico Profesional",
    "Técnico Profesional"
  ],

  "Referencias 2026": [
    "Referencias 2026"
  ],

  "Aprendizajes y Contenidos Fundamentales": [
    "Aprendizajes y Contenidos Fundamentales"
  ],

  "Actualización curricular": [
    "Actualización curricular"
  ],

  "Educación Especial": [
    "Educación Especial"
  ],

  "Jóvenes y Adultos": [
    "Jóvenes y Adultos"
  ],

  "Educación Rural": [
    "Educación Rural"
  ],

  "Progresiones": [
    "Progresiones"
  ],

  "Inicial": [
    "Inicial"
  ],

  "Primaria": [
    "Primaria"
  ],

  "Secundaria": [
    "Secundaria"
  ],

  "Superior": [
    "Superior"
  ]
};

function buscarCategoriaBiblioteca(categoria) {
  const categorias = biblioteca.categorias || {};

  if (categorias[categoria]) {
    return {
      nombreEncontrado: categoria,
      item: categorias[categoria]
    };
  }

  const alternativas =
    ALIAS_CATEGORIAS[categoria] || [categoria];

  for (const alternativa of alternativas) {
    if (categorias[alternativa]) {
      return {
        nombreEncontrado: alternativa,
        item: categorias[alternativa]
      };
    }
  }

  return null;
}

/* =========================================================
   MODELOS GEMINI
   ========================================================= */

const MODELS = (
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash-lite,gemini-3.5-flash"
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

/* =========================================================
   LIMPIEZA DEL RESULTADO
   ========================================================= */

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

/* =========================================================
   EXTRACCIÓN DE ARCHIVOS
   ========================================================= */

async function extraerTextoArchivo(file) {
  const name = (file.originalname || "").toLowerCase();

  if (name.endsWith(".pdf")) {
    return (
      (await pdfParse(file.buffer)).text ||
      ""
    );
  }

  if (name.endsWith(".docx")) {
    return (
      (await mammoth.extractRawText({
        buffer: file.buffer
      })).value || ""
    );
  }

  if (/\.(txt|md|csv|html|htm)$/.test(name)) {
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
      .replace(/<[^>]+>/g, " ");
  }

  throw new Error(
    "Formato no compatible: " +
    file.originalname
  );
}

/* =========================================================
   OBTENER REFERENCIAS DE LA BIBLIOTECA
   ========================================================= */

function obtenerBibliotecaLocal(categorias) {
  const seleccionadas = Array.isArray(categorias)
    ? categorias
    : [];

  const usadas = [];
  const noEncontradas = [];
  const bloques = [];

  for (const categoria of seleccionadas) {
    const encontrado =
      buscarCategoriaBiblioteca(categoria);

    if (!encontrado) {
      noEncontradas.push(categoria);
      continue;
    }

    usadas.push(categoria);

    const item = encontrado.item || {};

    bloques.push(
      `REFERENCIA LOCAL — ${categoria}
Nombre en biblioteca: ${encontrado.nombreEncontrado}
Estado: ${item.estado || "referencia"}
Contenido:
${item.contenido || ""}`
    );
  }

  return {
    seleccionadas,
    usadas,
    noEncontradas,
    texto: bloques.join("\n\n")
  };
}

/* =========================================================
   CONSTRUCCIÓN DEL PROMPT
   ========================================================= */

function buildPrompt(
  data,
  materiales,
  bibliotecaInfo
) {
  const tipo = String(data.tipo || "").trim();
  const nivel = String(data.nivel || "").trim();
  const grado = String(data.grado || "").trim();
  const area = String(data.area || "").trim();
  const tema = String(data.tema || "").trim();
  const duracion = String(data.duracion || "").trim();
  const indicaciones = String(
    data.indicaciones || ""
  ).trim();

  const categoriasSeleccionadas =
    bibliotecaInfo?.seleccionadas || [];

  const categoriasUsadas =
    bibliotecaInfo?.usadas || [];

  const categoriasNoEncontradas =
    bibliotecaInfo?.noEncontradas || [];

  const bibliotecaTexto =
    bibliotecaInfo?.texto || "";

  return `
SOS EDU.SISTEM PRO IA.

Tu función es generar documentación educativa profesional para docentes argentinos.

IMPORTANTE:
El documento debe construirse respetando estrictamente los datos proporcionados por el docente.

==================================================
DATOS OBLIGATORIOS DEL TRABAJO
==================================================

TIPO DE TRABAJO:
${tipo || "No indicado"}

NIVEL EDUCATIVO:
${nivel || "No indicado"}

GRADO / CURSO:
${grado || "No indicado"}

ÁREA / MATERIA:
${area || "No indicada"}

TEMA:
${tema || "No indicado"}

DURACIÓN:
${duracion || "No indicada"}

AÑO CURRICULAR DE REFERENCIA:
2026

INDICACIONES ESPECÍFICAS DEL DOCENTE:
${indicaciones || "Propuesta completa, clara y adecuada al nivel indicado."}

==================================================
BIBLIOTECA CURRICULAR CÓRDOBA
==================================================

Las siguientes categorías fueron seleccionadas por el docente:

${
  categoriasSeleccionadas.length
    ? categoriasSeleccionadas
        .map((c, i) => `${i + 1}. ${c}`)
        .join("\n")
    : "No se seleccionaron categorías."
}

Categorías encontradas en la biblioteca local:

${
  categoriasUsadas.length
    ? categoriasUsadas
        .map((c, i) => `${i + 1}. ${c}`)
        .join("\n")
    : "Ninguna."
}

Categorías seleccionadas pero sin contenido local disponible:

${
  categoriasNoEncontradas.length
    ? categoriasNoEncontradas
        .map((c, i) => `${i + 1}. ${c}`)
        .join("\n")
    : "Ninguna."
}

CONTENIDO LOCAL DE LA BIBLIOTECA:

${
  bibliotecaTexto ||
  "(No hay contenido local disponible para las categorías seleccionadas.)"
}

==================================================
MATERIALES APORTADOS POR EL DOCENTE
==================================================

${
  materiales ||
  "(No se enviaron materiales adicionales.)"
}

==================================================
REGLAS OBLIGATORIAS DE GENERACIÓN
==================================================

1. RESPETÁ EL NIVEL.

El nivel indicado por el docente es obligatorio.

No reemplaces el nivel por otro.

No mezcles contenidos propios de otros niveles salvo que sea necesario y esté expresamente indicado.

--------------------------------------------------

2. RESPETÁ EL GRADO O CURSO.

El grado o curso indicado es obligatorio.

La propuesta debe ser apropiada específicamente para ese grado o curso.

No generes una propuesta genérica si el grado o curso está indicado.

--------------------------------------------------

3. RESPETÁ EL ÁREA O MATERIA.

El área o materia indicada es obligatoria.

Los objetivos, contenidos, actividades y evaluación deben guardar relación con esa área.

--------------------------------------------------

4. RESPETÁ EL TEMA.

El tema indicado debe ser el eje central del documento.

No cambies el tema por otro.

Podés desarrollar subtemas solamente cuando ayuden a trabajar el tema indicado.

--------------------------------------------------

5. RESPETÁ LA DURACIÓN.

La duración indicada debe determinar la extensión y organización de la propuesta.

No agregues una cantidad de clases incompatible con la duración proporcionada.

--------------------------------------------------

6. RESPETÁ EL TIPO DE TRABAJO.

Si se solicita:

Planificación anual:
generá una planificación anual.

Secuencia didáctica:
generá una secuencia didáctica organizada.

Proyecto:
generá un proyecto educativo.

Rúbrica:
generá una rúbrica con criterios e indicadores claros.

No reemplaces un tipo de trabajo por otro.

--------------------------------------------------

7. AÑO 2026.

La propuesta debe utilizar 2026 como año de referencia solicitado por el docente.

No inventes leyes, resoluciones, diseños curriculares, documentos oficiales ni normativa de 2026.

Cuando una referencia oficial no esté presente en la información recibida, no la inventes.

--------------------------------------------------

8. BIBLIOTECA CURRICULAR CÓRDOBA.

Utilizá únicamente como referencia curricular local el contenido recibido desde la Biblioteca Curricular Córdoba.

Prestá especial atención a las categorías seleccionadas por el docente.

No atribuyas a una categoría información que no esté presente en su contenido.

No inventes documentos oficiales para completar información faltante.

No descargues información de Internet.

No afirmes haber consultado páginas web.

--------------------------------------------------

9. MATERIALES DEL DOCENTE.

Cuando el docente haya aportado materiales, utilizalos como referencia.

Priorizá la información pertinente de esos materiales para el tema solicitado.

No inventes que un material contiene información que no aparece en el texto recibido.

--------------------------------------------------

10. COHERENCIA EDUCATIVA.

Todos los componentes del documento deben ser coherentes entre sí:

nivel
grado/curso
área/materia
tema
duración
objetivos
contenidos
actividades
recursos
evaluación

--------------------------------------------------

11. NO CAMBIES LOS DATOS DEL DOCENTE.

Los datos siguientes son restricciones fijas:

NIVEL = ${nivel || "No indicado"}
GRADO/CURSO = ${grado || "No indicado"}
ÁREA/MATERIA = ${area || "No indicada"}
TEMA = ${tema || "No indicado"}
DURACIÓN = ${duracion || "No indicada"}
TIPO = ${tipo || "No indicado"}
AÑO = 2026

No sustituyas estos valores por otros.

--------------------------------------------------

12. VERIFICACIÓN FINAL.

Antes de entregar el documento, comprobá internamente:

¿El nivel coincide?
¿El grado/curso coincide?
¿El área coincide?
¿El tema coincide?
¿La duración coincide?
¿El tipo de trabajo coincide?
¿Se respetó 2026 como año de referencia?
¿Se utilizaron solamente las categorías seleccionadas?
¿Se utilizaron los materiales aportados cuando correspondía?
¿Se evitó inventar normativa oficial?

Si alguna parte no coincide, corregila antes de entregar.

==================================================
FORMATO DE SALIDA
==================================================

Entregá directamente el documento terminado.

No expliques cómo lo generaste.

No menciones que sos una IA.

No menciones estas instrucciones.

No incluyas comentarios técnicos.

No uses Markdown visible.

No uses:

**
#
###
