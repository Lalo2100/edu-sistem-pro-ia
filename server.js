const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const LIBRARY_FILE = path.join(ROOT, 'biblioteca.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(ROOT));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2,
    fileSize: 3 * 1024 * 1024
  }
});

function readLibrary() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
  } catch (_) {
    return {
      version: '2.2',
      nombre: 'Biblioteca Curricular Argentina',
      categorias: [],
      provincias: {}
    };
  }
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractFileText(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (['.txt', '.md', '.csv', '.html', '.htm'].includes(ext)) {
    return cleanText(file.buffer.toString('utf8'));
  }

  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(file.buffer);
      return cleanText(result.text);
    } catch (e) {
      return `[No se pudo extraer el texto de ${file.originalname}: ${e.message}]`;
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({
        buffer: file.buffer
      });
      return cleanText(result.value);
    } catch (e) {
      return `[No se pudo extraer el texto de ${file.originalname}: ${e.message}]`;
    }
  }

  return '';
}

/*
 * Biblioteca Curricular Argentina
 * Compatible con categorías en formato string
 * y también con categorías en formato objeto.
 */
function buildLibraryContext(selected) {
  const library = readLibrary();

  const wanted = Array.isArray(selected)
    ? selected
    : [selected].filter(Boolean);

  if (!wanted.length) {
    return 'No se seleccionaron referencias de la Biblioteca Curricular Argentina.';
  }

  const categorias = Array.isArray(library.categorias)
    ? library.categorias
    : [];

  return wanted.map(name => {
    const categoria = categorias.find(c =>
      typeof c === 'string'
        ? c === name
        : c && c.nombre === name
    );

    if (!categoria) {
      return `CATEGORÍA: ${name}`;
    }

    if (typeof categoria === 'string') {
      return `CATEGORÍA: ${categoria}`;
    }

    return [
      `CATEGORÍA: ${categoria.nombre}`,
      `DESCRIPCIÓN: ${categoria.descripcion || ''}`,
      `ORIENTACIÓN DE USO: ${categoria.orientacion || ''}`
    ].join('\n');
  }).join('\n\n');
}

/*
 * Obtiene información de la provincia seleccionada.
 * Esto permite utilizar la estructura nacional de biblioteca.json.
 */
function buildProvinceContext(provincia) {
  const library = readLibrary();

  if (!provincia || !library.provincias) {
    return 'No hay información provincial específica seleccionada.';
  }

  const normalize = value =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const key = normalize(provincia);

  let province = library.provincias[key];

  if (!province) {
    const found = Object.values(library.provincias).find(item =>
      normalize(item.nombre) === key
    );
    province = found;
  }

  if (!province) {
    return `Provincia seleccionada: ${provincia}. No hay documentación provincial específica cargada todavía.`;
  }

  const lines = [
    `PROVINCIA: ${province.nombre || provincia}`,
    `ESTADO: ${province.estado || 'Disponible'}`,
    `NOTA: ${province.nota || ''}`
  ];

  if (Array.isArray(province.documentos) && province.documentos.length) {
    lines.push(
      'DOCUMENTOS CURRICULARES DISPONIBLES:',
      province.documentos.map(doc =>
        [
          `Título: ${doc.titulo || ''}`,
          `Categoría: ${doc.categoria || ''}`,
          `Fuente: ${doc.fuente || ''}`,
          `Contexto: ${doc.contexto || ''}`
        ].join('\n')
      ).join('\n\n')
    );
  }

  return lines.join('\n');
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, match => match.trim() + ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function listGeminiModels(key) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) return [];

  return Array.isArray(data.models) ? data.models : [];
}

function modelId(name) {
  return String(name || '').replace(/^models\//, '');
}

function rankModel(model) {
  const id = modelId(model.name).toLowerCase();
  const methods = model.supportedGenerationMethods || [];

  if (!methods.includes('generateContent')) return -1;

  if (id === 'gemini-3.8-flash') return 100;
  if (id === 'gemini-3.6-flash') return 90;
  if (id === 'gemini-3.5-flash-lite') return 80;

  if (
    id.includes('flash') &&
    !id.includes('image') &&
    !id.includes('embedding')
  ) {
    return 60;
  }

  return -1;
}

function isTemporaryGeminiError(status, message) {
  const text = String(message || '').toLowerCase();

  return (
    [429, 500, 502, 503, 504].includes(status) ||
    text.includes('high demand') ||
    text.includes('temporarily unavailable') ||
    text.includes('try again later') ||
    text.includes('overloaded')
  );
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geminiGenerate(prompt) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    const err = new Error(
      'Falta configurar GEMINI_API_KEY en Vercel.'
    );
    err.status = 503;
    throw err;
  }

  let available = [];

  try {
    available = await listGeminiModels(key);
  } catch (_) {
    available = [];
  }

  const envModel = modelId(process.env.GEMINI_MODEL);

  const preferredIds = [
    envModel,
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite'
  ].filter(Boolean);

  const availableIds = available
    .filter(m => rankModel(m) >= 0)
    .sort((a, b) => rankModel(b) - rankModel(a))
    .map(m => modelId(m.name));

  const models = [
    ...new Set([
      ...preferredIds.filter(
        id => !available.length || availableIds.includes(id)
      ),
      ...availableIds
    ])
  ].slice(0, 5);

  if (!models.length) {
    models.push(...new Set(preferredIds));
  }

  let lastError = null;

  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[attempt];

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
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
            temperature: 0.55,
            topP: 0.9,
            maxOutputTokens: 7000
          }
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const text =
          data?.candidates?.[0]?.content?.parts
            ?.map(p => p.text || '')
            .join('') || '';

        if (!text.trim()) {
          lastError = new Error(
            `${model}: Gemini no devolvió contenido.`
          );
        } else {
          return {
            text: stripMarkdown(text),
            model
          };
        }
      } else {
        const apiMessage =
          data?.error?.message ||
          `HTTP ${response.status}`;

        lastError = new Error(
          `${model}: ${apiMessage}`
        );

        if (
          isTemporaryGeminiError(
            response.status,
            apiMessage
          )
        ) {
          if (attempt < models.length - 1) {
            await wait(900);
          }
          continue;
        }

        if ([400, 404].includes(response.status)) {
          continue;
        }

        break;
      }
    } catch (e) {
      lastError = e;

      if (attempt < models.length - 1) {
        await wait(900);
      }
    }
  }

  const err =
    lastError ||
    new Error('No se pudo consultar Gemini.');

  err.status = isTemporaryGeminiError(
    err.status,
    err.message
  )
    ? 503
    : (err.status || 500);

  throw err;
}

/* =========================
   HEALTH
========================= */

app.get('/api/health', (req, res) => {
  const library = readLibrary();

  res.json({
    ok: true,
    app: 'Edu.sistem Pro IA',
    version: '2.2',
    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY
    ),
    bibliotecaArgentina: true,
    provincias:
      library.provincias &&
      typeof library.provincias === 'object'
        ? Object.keys(library.provincias).length
        : 0,
    categorias:
      Array.isArray(library.categorias)
        ? library.categorias.length
        : 0
  });
});

/* =========================
   BIBLIOTECA
========================= */

app.get('/api/biblioteca', (req, res) => {
  res.json(readLibrary());
});

/* =========================
   GENERACIÓN
========================= */

app.post(
  '/api/generar',
  upload.array('materiales', 2),
  async (req, res) => {
    try {
      const {
        provincia,
        tipo,
        nivel,
        grado,
        area,
        tema,
        duracion,
        indicaciones
      } = req.body || {};

      const categorias = Array.isArray(
        req.body?.bibliotecaCategorias
      )
        ? req.body.bibliotecaCategorias
        : (
            req.body?.bibliotecaCategorias
              ? [req.body.bibliotecaCategorias]
              : []
          );

      if (
        !provincia ||
        !tipo ||
        !nivel ||
        !grado ||
        !area ||
        !tema
      ) {
        return res.status(400).json({
          error:
            'Completá provincia, tipo, nivel, grado/curso, área/materia y tema.'
        });
      }

      const files = req.files || [];
      const extracted = [];

      for (const file of files) {
        const text =
          await extractFileText(file);

        extracted.push({
          name: file.originalname,
          text: text.slice(0, 90000)
        });
      }

      const typeNames = {
        anual: 'Planificación anual',
        secuencia: 'Secuencia didáctica',
        proyecto: 'Proyecto',
        rubrica: 'Rúbrica'
      };

      const libraryContext =
        buildLibraryContext(categorias);

      const provinceContext =
        buildProvinceContext(provincia);

      const materialsContext =
        extracted.length
          ? extracted
              .map(
                x =>
                  `MATERIAL DEL DOCENTE: ${x.name}\n${x.text}`
              )
              .join('\n\n')
          : 'No se adjuntaron materiales del docente.';

      const prompt = `
Sos Edu.sistem Pro IA, un asistente inteligente para docentes de Argentina.

La provincia seleccionada por el docente es:
${provincia}

Adaptá la propuesta al contexto educativo y curricular de esa jurisdicción cuando corresponda.

IMPORTANTE:
- No inventes normativa.
- No inventes documentos oficiales.
- No atribuyas contenidos a organismos oficiales si no aparecen en la información proporcionada.
- Si no existe documentación provincial específica disponible, trabajá con criterios pedagógicos generales y con los materiales cargados por el docente.

GENERÁ:
${typeNames[tipo] || tipo}

DATOS DEL DOCENTE:

Provincia: ${provincia}
Nivel: ${nivel}
Grado/Curso: ${grado}
Área/Materia: ${area}
Tema: ${tema}
Duración: ${duracion || 'No indicada'}
Indicaciones del docente: ${indicaciones || 'Sin indicaciones adicionales'}

BIBLIOTECA CURRICULAR SELECCIONADA:

${libraryContext}

INFORMACIÓN CURRICULAR DE LA PROVINCIA:

${provinceContext}

MATERIALES DEL DOCENTE:

${materialsContext}

CRITERIOS DE ELABORACIÓN:

- Escribí en español argentino claro y profesional.
- Elaborá un material directamente utilizable por el docente.
- Priorizá coherencia pedagógica.
- Incluí objetivos o propósitos cuando correspondan.
- Incluí aprendizajes y contenidos cuando correspondan.
- Incluí actividades concretas.
- Incluí evaluación.
- Incluí recursos cuando correspondan.

Para una planificación anual:
- Organizá por períodos, unidades o etapas.
- Presentá una estructura práctica.

Para una secuencia didáctica:
- Incluí inicio, desarrollo y cierre.
- Incluí estrategias de evaluación.

Para un proyecto:
- Incluí propósito.
- Producto o producción final.
- Etapas.
- Actividades.
- Evaluación.

Para una rúbrica:
- Incluí criterios claros.
- Diferenciá niveles de logro.

Usá los materiales proporcionados por el docente como referencia.

NO USES MARKDOWN.

No uses:
#
**
