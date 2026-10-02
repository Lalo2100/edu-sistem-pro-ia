process.on('uncaughtException', (err) => {
  console.error('🔥 ERROR CRÍTICO NO CAPTURADO:', err.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 PROMESA RECHAZADA NO CAPTURADA:', reason);
});

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const LIBRARY_FILE = path.join(ROOT, 'biblioteca.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Inicializar cliente de Supabase de forma segura y blindada
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY ||
  'placeholder-key';

let supabase = null;
try {
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase conectado correctamente');
  } else {
    console.warn('Supabase omitido: faltan credenciales');
  }
} catch (err) {
  console.error('Error al inicializar Supabase:', err.message);
}

// Configuración de Mercado Pago (aceptando tu variable de Vercel)
const mpAccessToken =
  process.env.MERCADOPAGO_ACCESS_TOKEN ||
  process.env.MP_ACCESS_TOKEN ||
  '';
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
    return JSON.parse(
      fs.readFileSync(LIBRARY_FILE, 'utf8')
    );
  } catch (error) {
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
    } catch (error) {
      return `[No se pudo extraer el texto de ${file.originalname}]`;
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({
        buffer: file.buffer
      });
      return cleanText(result.value);
    } catch (error) {
      return `[No se pudo extraer el texto de ${file.originalname}]`;
    }
  }

  return '';
}

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

  return wanted.map(function (name) {
    const categoria = categorias.find(function (item) {
      if (typeof item === 'string') {
        return item === name;
      }

      return item && item.nombre === name;
    });

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

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildProvinceContext(provincia) {
  const library = readLibrary();

  if (!provincia || !library.provincias) {
    return 'No hay información provincial específica seleccionada.';
  }

  const key = normalizeKey(provincia);

  let province = library.provincias[key];

  if (!province) {
    province = Object.values(library.provincias).find(function (item) {
      return normalizeKey(item && item.nombre) === key;
    });
  }

  if (!province) {
    return `Provincia seleccionada: ${provincia}. No hay documentación provincial específica cargada todavía.`;
  }

  const lines = [
    `PROVINCIA: ${province.nombre || provincia}`,
    `ESTADO: ${province.estado || 'Disponible'}`,
    `NOTA: ${province.nota || ''}`
  ];

  if (
    Array.isArray(province.documentos) &&
    province.documentos.length
  ) {
    lines.push(
      'DOCUMENTOS CURRICULARES DISPONIBLES:',
      province.documentos.map(function (doc) {
        return [
          `Título: ${doc.titulo || ''}`,
          `Categoría: ${doc.categoria || ''}`,
          `Fuente: ${doc.fuente || ''}`,
          `Contexto: ${doc.contexto || ''}`
        ].join('\n');
      }).join('\n\n')
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
    .replace(/^\s*\d+\.\s+/gm, '$&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function listGeminiModels(key) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;

  const response = await fetch(url);
  const data = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    return [];
  }

  return Array.isArray(data.models)
    ? data.models
    : [];
}

function modelId(name) {
  return String(name || '')
    .replace(/^models\//, '');
}

function rankModel(model) {
  const id = modelId(model.name).toLowerCase();
  const methods = model.supportedGenerationMethods || [];

  if (!methods.includes('generateContent')) {
    return -1;
  }

  if (id === 'gemini-3.8-flash') {
    return 100;
  }

  if (id === 'gemini-3.6-flash') {
    return 90;
  }

  if (id === 'gemini-3.5-flash-lite') {
    return 80;
  }

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
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function geminiGenerate(prompt) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    const error = new Error(
      'Falta configurar GEMINI_API_KEY en Vercel.'
    );

    error.status = 503;
    throw error;
  }

  let available = [];

  try {
    available = await listGeminiModels(key);
  } catch (error) {
    available = [];
  }

  const envModel = modelId(
    process.env.GEMINI_MODEL
  );

  const preferredIds = [
    envModel,
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite'
  ].filter(Boolean);

  const availableIds = available
    .filter(function (model) {
      return rankModel(model) >= 0;
    })
    .sort(function (a, b) {
      return rankModel(b) - rankModel(a);
    })
    .map(function (model) {
      return modelId(model.name);
    });

  const models = [
    ...new Set([
      ...preferredIds.filter(function (id) {
        return !available.length ||
          availableIds.includes(id);
      }),
      ...availableIds
    ])
  ].slice(0, 5);

  if (!models.length) {
    models.push(
      ...new Set(preferredIds)
    );
  }

  let lastError = null;

  for (
    let attempt = 0;
    attempt < models.length;
    attempt++
  ) {
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

      const data = await response.json().catch(function () {
        return {};
      });

      if (response.ok) {
        const text =
          data &&
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts
            ? data.candidates[0].content.parts
                .map(function (part) {
                  return part.text || '';
                })
                .join('')
            : '';

        if (!text.trim()) {
          lastError = new Error(
            `${model}: Gemini no devolvió contenido.`
          );
        } else {
          return {
            text: stripMarkdown(text),
            model: model
          };
        }
      } else {
        const apiMessage =
          data &&
          data.error &&
          data.error.message
            ? data.error.message
            : `HTTP ${response.status}`;

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
    } catch (error) {
      lastError = error;

      if (attempt < models.length - 1) {
        await wait(900);
      }
    }
  }

  const error =
    lastError ||
    new Error('No se pudo consultar Gemini.');

  error.status =
    isTemporaryGeminiError(
      error.status,
      error.message
    )
      ? 503
      : (error.status || 500);

  throw error;
}

app.get('/api/health', function (req, res) {
  const library = readLibrary();

  res.json({
    ok: true,
    app: 'Edu.sistem Pro IA',
    version: '2.2',
    geminiConfigured:
      Boolean(process.env.GEMINI_API_KEY),
    bibliotecaArgentina: true,
    provincias:
      library.provincias &&
      typeof library.provincias === 'object'
        ? Object.keys(
            library.provincias
          ).length
        : 0,
    categorias:
      Array.isArray(library.categorias)
        ? library.categorias.length
        : 0
  });
});

app.get('/api/biblioteca', function (req, res) {
  res.json(readLibrary());
});

app.post(
  '/api/generar',
  upload.array('materiales', 2),
  async function (req, res) {
    try {
      const {
        userId,
        provincia,
        tipo,
        nivel,
        grado,
        area,
        tema,
        duracion,
        indicaciones
      } = req.body || {};

      if (!userId) {
        return res.status(401).json({
          error: 'Usuario no autenticado. Iniciá sesión para continuar.'
        });
      }

      // --- VALIDAR LÍMITE EN SUPABASE ---
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('plan, generations_used, generation_limit')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({
          error: 'No se encontró el perfil del usuario en la base de datos.'
        });
      }

      if (profile.generations_used >= profile.generation_limit) {
        return res.status(403).json({
          error: '🚫 Límite de generaciones alcanzado. Actualizá tu plan para continuar.'
        });
      }
      // ---------------------------------

      const categorias =
        Array.isArray(
          req.body &&
          req.body.bibliotecaCategorias
        )
          ? req.body.bibliotecaCategorias
          : (
              req.body &&
              req.body.bibliotecaCategorias
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
          ? extracted.map(function (item) {
              return (
                `MATERIAL DEL DOCENTE: ${item.name}\n` +
                item.text
              );
            }).join('\n\n')
          : 'No se adjuntaron materiales del docente.';

      const prompt = `
Sos Edu.sistem Pro IA, un asistente inteligente para docentes de Argentina.

La provincia seleccionada es:
${provincia}

Adaptá la propuesta al contexto educativo y curricular de esa jurisdicción cuando corresponda.

No inventes normativa ni documentos oficiales.
No atribuyas contenidos a organismos oficiales si no aparecen en la información proporcionada.

TIPO DE TRABAJO:
${typeNames[tipo] || tipo}

DATOS:

Provincia: ${provincia}
Nivel: ${nivel}
Grado/Curso: ${grado}
Área/Materia: ${area}
Tema: ${tema}
Duración: ${duracion || 'No indicada'}
Indicaciones del docente: ${indicaciones || 'Sin indicaciones adicionales'}

BIBLIOTECA CURRICULAR:

${libraryContext}

INFORMACIÓN DE LA PROVINCIA:

${provinceContext}

MATERIALES DEL DOCENTE:

${materialsContext}

CRITERIOS:

- Escribí en español argentino claro y profesional.
- Elaborá un material directamente utilizable por el docente.
- Priorizá coherencia pedagógica.
- Incluí objetivos o propósitos cuando correspondan.
- Incluí aprendizajes y contenidos cuando correspondan.
- Incluí actividades concretas.
- Incluí evaluación.
- Incluí recursos cuando correspondan.

Para planificación anual:
Organizá por períodos, unidades o etapas.

Para secuencia didáctica:
Incluí inicio, desarrollo, cierre y evaluación.

Para proyecto:
Incluí propósito, producto final, etapas, actividades y evaluación.

Para rúbrica:
Incluí criterios y niveles de logro claramente diferenciados.

Usá los materiales proporcionados por el docente como referencia.

Entregá texto limpio.
No uses Markdown.
No uses # ni **.
No expliques cómo funciona la IA.
Entregá directamente el trabajo docente.
`;

      const result =
        await geminiGenerate(prompt);

      // --- INCREMENTAR CONTADOR EN SUPABASE (+1) ---
      const nuevoConteo = (profile.generations_used || 0) + 1;
      
      await supabase
        .from('profiles')
        .update({ generations_used: nuevoConteo })
        .eq('id', userId);
      // --------------------------------------------

      return res.json({
        ok: true,
        texto: result.text,
        modelo: result.model,
        generations_used: nuevoConteo,
        generation_limit: profile.generation_limit,
        materialesUsados:
          extracted.map(function (item) {
            return item.name;
          }),
        bibliotecaCategorias: categorias,
        provincia: provincia
      });

    } catch (error) {
      console.error(
        'Error /api/generar:',
        error
      );

      const status =
        error.status || 500;

      return res.status(status).json({
        error:
          status === 503
            ? error.message
            : `No se pudo generar el trabajo. ${error.message || ''}`.trim()
      });
    }
  }
);

app.get('*', function (req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Endpoint no encontrado.'
    });
  }

  return res.sendFile(
    path.join(ROOT, 'index.html')
  );
});

if (require.main === module) {
  app.listen(PORT, function () {
    console.log(
      `Edu.sistem Pro IA escuchando en ${PORT}`
    );
  });
}
// --- ENDPOINTS DE MERCADO PAGO Y PAGOS ---

// 1. Crear preferencia de pago (Inicia el Checkout Pro)
app.post('/api/crear-preferencia', async function (req, res) {
  try {
    const { userId, email } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado.' });
    }

    const mpAccessToken = process.env.MP_ACCESS_TOKEN;
    if (!mpAccessToken) {
      return res.status(503).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel.' });
    }

    const preferenceData = {
      items: [
        {
          title: 'Edu.sistem Pro IA - Plan Pro (Ilimitado)',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: 5000.00 // Ajustá el precio según tu conveniencia
        }
      ],
      payer: {
        email: email || 'docente@edu.sistem.pro'
      },
      external_reference: userId, // Vinculamos el pago directamente con el ID del usuario en Supabase
      back_urls: {
        success: `${req.protocol}://${req.get('host')}?pagado=true`,
        failure: `${req.protocol}://${req.get('host')}?pagado=false`,
        pending: `${req.protocol}://${req.get('host')}?pagado=pending`
      },
      auto_return: 'approved'
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpAccessToken}`
      },
      body: JSON.stringify(preferenceData)
    });

    const mpResult = await mpResponse.json();

    if (!mpResponse.ok) {
      throw new Error(mpResult.message || 'Error al crear la preferencia en Mercado Pago.');
    }

    return res.json({
      ok: true,
      init_point: mpResult.init_point // Link de pago para redirigir al usuario
    });

  } catch (error) {
    console.error('Error /api/crear-preferencia:', error);
    return res.status(500).json({ error: error.message || 'No se pudo iniciar el pago.' });
  }
});

// 2. Webhook para recibir la confirmación de pago de Mercado Pago
app.post('/api/webhook', async function (req, res) {
  try {
    const event = req.body;

    // Verificamos si la notificación corresponde a un pago aprobado
    if (event && (event.type === 'payment' || event.action === 'payment.created')) {
      const paymentId = event.data && event.data.id;

      if (paymentId) {
        const mpAccessToken = process.env.MP_ACCESS_TOKEN;
        
        // Consultamos el detalle del pago a la API de Mercado Pago
        const payResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: {
            'Authorization': `Bearer ${mpAccessToken}`
          }
        });

        const payData = await payResponse.json();

        if (payResponse.ok && payData.status === 'approved') {
          const userId = payData.external_reference; // Recuperamos el UUID del usuario guardado en la preferencia

          if (userId) {
            // Actualizamos el perfil en Supabase: Plan Pro e incrementamos el límite a ilimitado o un número alto
            await supabase
              .from('profiles')
              .update({
                plan: 'pro',
                generation_limit: 9999, // Límite amplio o ilimitado para cuentas pagas
                generations_used: 0     // Reseteamos el contador actual al pagar
              })
              .eq('id', userId);
          }
        }
      }
    }

    // Respondemos siempre 200 a Mercado Pago para confirmar recepción
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Error en /api/webhook:', error);
    return res.status(500).json({ error: 'Error procesando webhook.' });
  }
});
module.exports = app;
