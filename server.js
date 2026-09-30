const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const LIBRARY_FILE = path.join(ROOT, 'biblioteca-cordoba.json');
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
    return { app: 'Edu.sistem Pro IA', version: '2.5', categorias: [] };
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
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return cleanText(result.value);
    } catch (e) {
      return `[No se pudo extraer el texto de ${file.originalname}: ${e.message}]`;
    }
  }
  return '';
}

function buildLibraryContext(selected) {
  const library = readLibrary();
  const wanted = Array.isArray(selected) ? selected : [selected].filter(Boolean);
  if (!wanted.length) return 'No se seleccionaron referencias de la Biblioteca Curricular Argentina.';
  return wanted.map(name => {
    const item = library.categorias.find(c => c.nombre === name);
    if (!item) return `Categoría seleccionada: ${name}`;
    return [
      `CATEGORÍA: ${item.nombre}`,
      `DESCRIPCIÓN: ${item.descripcion}`,
      `ORIENTACIÓN DE USO: ${item.orientacion}`
    ].join('\n');
  }).join('\n\n');
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
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
  if (id.includes('flash') && !id.includes('image') && !id.includes('embedding')) return 60;
  return -1;
}

function isTemporaryGeminiError(status, message) {
  const text = String(message || '').toLowerCase();
  return [429, 500, 502, 503, 504].includes(status)
    || text.includes('high demand')
    || text.includes('temporarily unavailable')
    || text.includes('try again later')
    || text.includes('overloaded');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geminiGenerate(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const err = new Error('Falta configurar GEMINI_API_KEY en Vercel.');
    err.status = 503;
    throw err;
  }

  // Primero consultamos los modelos disponibles para esa API key. Esto evita
  // quedar atados a un único modelo si Google cambia disponibilidad o demanda.
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

  // Conservamos primero los modelos preferidos que realmente estén disponibles.
  const models = [...new Set([
    ...preferredIds.filter(id => !available.length || availableIds.includes(id)),
    ...availableIds
  ])].slice(0, 5);

  // Si el listado no devolvió modelos, usamos los respaldos conocidos.
  if (!models.length) models.push(...new Set(preferredIds));

  let lastError = null;
  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[attempt];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.55,
            topP: 0.9,
            maxOutputTokens: 7000
          }
        })
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if (!text.trim()) {
          lastError = new Error(`${model}: Gemini no devolvió contenido.`);
        } else {
          return { text: stripMarkdown(text), model };
        }
      } else {
        const apiMessage = data?.error?.message || `HTTP ${response.status}`;
        lastError = new Error(`${model}: ${apiMessage}`);

        // Un modelo inexistente o no soportado se salta inmediatamente.
        // Una saturación temporal pasa al siguiente modelo después de una pausa.
        if (isTemporaryGeminiError(response.status, apiMessage)) {
          if (attempt < models.length - 1) await wait(900);
          continue;
        }
        if ([400, 404].includes(response.status)) continue;
        break;
      }
    } catch (e) {
      lastError = e;
      if (attempt < models.length - 1) await wait(900);
    }
  }

  const err = lastError || new Error('No se pudo consultar Gemini.');
  err.status = isTemporaryGeminiError(err.status, err.message) ? 503 : (err.status || 500);
  throw err;
}

app.get('/api/health', (req, res) => {
  const library = readLibrary();
  res.json({
    ok: true,
    app: 'Edu.sistem Pro IA',
    version: '2.1',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    libraryConfigured: Array.isArray(library.categorias) && library.categorias.length === 12
  });
});

app.get('/api/biblioteca', (req, res) => {
  res.json(readLibrary());
});

app.post('/api/generar', upload.array('materiales', 2), async (req, res) => {
  try {
    const { provincia, tipo, nivel, grado, area, tema, duracion, indicaciones } = req.body || {};
    const categorias = Array.isArray(req.body?.bibliotecaCategorias)
      ? req.body.bibliotecaCategorias
      : (req.body?.bibliotecaCategorias ? [req.body.bibliotecaCategorias] : []);

    if (!provincia || !tipo || !nivel || !grado || !area || !tema) {
      return res.status(400).json({ error: 'Completá provincia, tipo, nivel, grado/curso, área/materia y tema.' });
    }

    const files = req.files || [];
    const extracted = [];
    for (const file of files) {
      const text = await extractFileText(file);
      extracted.push({ name: file.originalname, text: text.slice(0, 90000) });
    }

    const typeNames = {
      anual: 'Planificación anual',
      secuencia: 'Secuencia didáctica',
      proyecto: 'Proyecto',
      rubrica: 'Rúbrica'
    };

    const libraryContext = buildLibraryContext(categorias);
    const materialsContext = extracted.length
      ? extracted.map(x => `MATERIAL DEL DOCENTE: ${x.name}\n${x.text}`).join('\n\n')
      : 'No se adjuntaron materiales del docente.';

    const prompt = `Sos Edu.sistem Pro IA, un asistente para docentes de Argentina. La provincia seleccionada por el docente es ${provincia}. Adaptá la propuesta al contexto curricular de esa jurisdicción cuando corresponda, sin inventar normativa ni documentos oficiales.\n\nGenerá un ${typeNames[tipo] || tipo} listo para usar en la práctica docente.\n\nDATOS:\nProvincia: ${provincia}\nNivel: ${nivel}\nGrado/Curso: ${grado}\nÁrea/Materia: ${area}\nTema: ${tema}\nDuración: ${duracion || 'No indicada'}\nIndicaciones del docente: ${indicaciones || 'Sin indicaciones adicionales'}\n\nBIBLIOTECA CURRICULAR SELECCIONADA:\n${libraryContext}\n\nMATERIALES DEL DOCENTE:\n${materialsContext}\n\nCRITERIOS:\n- Escribí en español argentino claro y profesional.\n- Priorizá coherencia pedagógica, objetivos/aprendizajes, contenidos, actividades, evaluación y recursos cuando correspondan al tipo de trabajo.\n- Para una planificación anual, organizá por períodos/unidades de manera práctica.\n- Para una secuencia, presentá inicio, desarrollo y cierre, con evaluación.\n- Para un proyecto, incluí propósito, producto o producción final, etapas y evaluación.\n- Para una rúbrica, incluí criterios y niveles de logro claramente diferenciados.\n- Usá los materiales proporcionados como referencia, sin inventar citas ni atribuir textos inexistentes.\n- Si la biblioteca solo aporta orientación de categoría y no un documento específico, no afirmes que citaste un documento oficial concreto.\n- No uses Markdown con # o **. Entregá texto limpio, con títulos simples y listas legibles.\n- No agregues explicaciones sobre cómo funciona la IA; entregá directamente el trabajo docente.\n`;

    const result = await geminiGenerate(prompt);

    res.json({
      ok: true,
      texto: result.text,
      modelo: result.model,
      materialesUsados: extracted.map(x => x.name),
      bibliotecaCategorias: categorias
    });
  } catch (error) {
    console.error('Error /api/generar:', error);
    const status = error.status || 500;
    res.status(status).json({
      error: status === 503
        ? error.message
        : `No se pudo generar el trabajo. ${error.message || ''}`.trim()
    });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint no encontrado.' });
  res.sendFile(path.join(ROOT, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Edu.sistem Pro IA escuchando en ${PORT}`);
  });
}

module.exports = app;
