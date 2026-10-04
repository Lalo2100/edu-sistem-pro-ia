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
app.use(express.static(ROOT));

/* =========================================================
   SUPABASE
========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;

/*
  Compatibilidad con los dos nombres que pueden existir
  actualmente en Vercel.
*/
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      )
    : null;

/* =========================================================
   PLANES
========================================================= */

const PLAN_LIMITS = {
  gratis: 5,
  docente: 100,
  profesional: 300,
  institucion: 1000
};

/* =========================================================
   ARCHIVOS
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2,
    fileSize: 3 * 1024 * 1024
  }
});

/* =========================================================
   BIBLIOTECA
========================================================= */

function readLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      return JSON.parse(
        fs.readFileSync(
          LIBRARY_FILE,
          'utf8'
        )
      );
    }
  } catch (error) {
    console.error(
      'Error leyendo biblioteca.json:',
      error.message
    );
  }

  return {
    version: '2.2',
    nombre: 'Biblioteca Curricular Argentina',
    categorias: [],
    provincias: {}
  };
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildLibraryContext(selected) {
  const library = readLibrary();

  const wanted = Array.isArray(selected)
    ? selected
    : [selected].filter(Boolean);

  if (!wanted.length) {
    return 'No se seleccionaron referencias de la Biblioteca Curricular Argentina.';
  }

  const categorias =
    Array.isArray(library.categorias)
      ? library.categorias
      : [];

  return wanted
    .map((name) => {
      const categoria = categorias.find(
        (item) => {
          if (typeof item === 'string') {
            return item === name;
          }

          return (
            item &&
            item.nombre === name
          );
        }
      );

      if (!categoria) {
        return `CATEGORÍA: ${name}`;
      }

      if (typeof categoria === 'string') {
        return `CATEGORÍA: ${categoria}`;
      }

      return [
        `CATEGORÍA: ${categoria.nombre || ''}`,
        `DESCRIPCIÓN: ${categoria.descripcion || ''}`,
        `ORIENTACIÓN: ${categoria.orientacion || ''}`
      ].join('\n');
    })
    .join('\n\n');
}

function buildProvinceContext(provincia) {
  const library = readLibrary();

  if (
    !provincia ||
    !library.provincias
  ) {
    return 'No hay información provincial específica seleccionada.';
  }

  const key =
    normalizeKey(provincia);

  let province =
    library.provincias[key];

  if (!province) {
    province =
      Object.values(
        library.provincias
      ).find((item) => {
        return (
          normalizeKey(
            item && item.nombre
          ) === key
        );
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
    Array.isArray(
      province.documentos
    ) &&
    province.documentos.length
  ) {
    lines.push(
      'DOCUMENTOS CURRICULARES DISPONIBLES:',
      province.documentos
        .map((doc) =>
          [
            `Título: ${doc.titulo || ''}`,
            `Categoría: ${doc.categoria || ''}`,
            `Fuente: ${doc.fuente || ''}`,
            `Contexto: ${doc.contexto || ''}`
          ].join('\n')
        )
        .join('\n\n')
    );
  }

  return lines.join('\n');
}

/* =========================================================
   ARCHIVOS DEL DOCENTE
========================================================= */

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractFileText(file) {
  const ext =
    path.extname(
      file.originalname
    ).toLowerCase();

  if (
    [
      '.txt',
      '.md',
      '.csv',
      '.html',
      '.htm'
    ].includes(ext)
  ) {
    return cleanText(
      file.buffer.toString('utf8')
    );
  }

  if (ext === '.pdf') {
    try {
      const pdfParse =
        require('pdf-parse');

      const result =
        await pdfParse(file.buffer);

      return cleanText(
        result.text
      );
    } catch (error) {
      console.error(
        `Error leyendo PDF ${file.originalname}:`,
        error.message
      );

      return `[No se pudo extraer el texto de ${file.originalname}]`;
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth =
        require('mammoth');

      const result =
        await mammoth.extractRawText({
          buffer: file.buffer
        });

      return cleanText(
        result.value
      );
    } catch (error) {
      console.error(
        `Error leyendo DOCX ${file.originalname}:`,
        error.message
      );

      return `[No se pudo extraer el texto de ${file.originalname}]`;
    }
  }

  return '';
}

/* =========================================================
   AUTENTICACIÓN
========================================================= */

async function authenticatedUser(req) {
  if (!supabase) {
    const error =
      new Error(
        'Supabase no está configurado en Vercel.'
      );

    error.status = 503;

    throw error;
  }

  const header =
    req.headers.authorization || '';

  if (
    !header.startsWith('Bearer ')
  ) {
    const error =
      new Error(
        'Necesitás iniciar sesión.'
      );

    error.status = 401;

    throw error;
  }

  const token =
    header
      .substring(7)
      .trim();

  if (!token) {
    const error =
      new Error(
        'Token de acceso inválido.'
      );

    error.status = 401;

    throw error;
  }

  const {
    data,
    error
  } = await supabase.auth.getUser(
    token
  );

  if (
    error ||
    !data ||
    !data.user
  ) {
    const authError =
      new Error(
        'La sesión no es válida o expiró.'
      );

    authError.status = 401;

    throw authError;
  }

  return data.user;
}

/* =========================================================
   PERFIL
========================================================= */

function normalizeProfile(profile) {
  if (!profile) {
    return null;
  }

  /*
    La aplicación trabajará con generations_limit.

    Si una instalación antigua todavía tiene
    generation_limit, usamos ese valor como respaldo.
  */

  const rawLimit =
    profile.generations_limit ??
    profile.generation_limit ??
    PLAN_LIMITS[
      profile.plan || 'gratis'
    ] ??
    PLAN_LIMITS.gratis;

  const limit =
    Number(rawLimit) ||
    PLAN_LIMITS.gratis;

  const used =
    Number(
      profile.generations_used
    ) || 0;

  return {
    ...profile,

    generations_limit: limit,
    generations_used: used,

    /*
      Alias temporal para compatibilidad
      con el frontend anterior.
    */
    generation_limit: limit
  };
}

async function getProfile(
  userId,
  email
) {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado.'
    );
  }

  let {
    data,
    error
  } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const {
      data: created,
      error: createError
    } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email: email || '',
        plan: 'gratis',

        /*
          Nombre correcto.
        */
        generations_limit:
          PLAN_LIMITS.gratis,

        generations_used: 0,

        billing_period_start:
          new Date().toISOString()
      })
      .select('*')
      .single();

    if (createError) {
      throw createError;
    }

    data = created;
  }

  return normalizeProfile(
    data
  );
}

/* =========================================================
   CONSUMO DE GENERACIÓN
========================================================= */

async function consumeGeneration(
  userId
) {
  if (!supabase) {
    const error =
      new Error(
        'Supabase no está configurado.'
      );

    error.status = 503;

    throw error;
  }

  const {
    data,
    error
  } = await supabase.rpc(
    'consume_generation',
    {
      p_user_id: userId
    }
  );

  if (error) {
    console.error(
      'Error consume_generation:',
      error
    );

    throw error;
  }

  if (
    !data ||
    data.allowed === false
  ) {
    const limitError =
      new Error(
        'Alcanzaste el límite de generaciones de tu plan.'
      );

    limitError.status = 403;
    limitError.profile = data;

    throw limitError;
  }

  /*
    Normalizamos la respuesta para que
    el frontend siempre reciba el mismo formato.
  */

  const limit =
    Number(
      data.generations_limit ??
      data.generation_limit
    ) || 5;

  const used =
    Number(
      data.generations_used
    ) || 0;

  const remaining =
    Math.max(
      0,
      Number(
        data.remaining
      ) ||
        limit - used
    );

  return {
    ...data,

    generations_used: used,
    generations_limit: limit,

    /*
      Compatibilidad.
    */
    generation_limit: limit,

    remaining
  };
}

async function releaseGeneration(
  userId
) {
  if (!supabase) {
    return;
  }

  try {
    const {
      error
    } = await supabase.rpc(
      'release_generation',
      {
        p_user_id: userId
      }
    );

    if (error) {
      console.error(
        'No se pudo devolver la generación:',
        error.message
      );
    }
  } catch (error) {
    console.error(
      'Error liberando generación:',
      error.message
    );
  }
}

/* =========================================================
   GEMINI
========================================================= */

function stripMarkdown(text) {
  return String(text || '')
    .replace(
      /^#{1,6}\s*/gm,
      ''
    )
    .replace(
      /\*\*(.*?)\*\*/g,
      '$1'
    )
    .replace(
      /__(.*?)__/g,
      '$1'
    )
    .replace(
      /`([^`]+)`/g,
      '$1'
    )
    .replace(
      /^\s*[-*]\s+/gm,
      '• '
    )
    .replace(
      /\n{3,}/g,
      '\n\n'
    )
    .trim();
}

async function geminiGenerate(
  prompt
) {
  const key =
    process.env.GEMINI_API_KEY;

  if (!key) {
    const error =
      new Error(
        'Falta configurar GEMINI_API_KEY en Vercel.'
      );

    error.status = 503;

    throw error;
  }

  const model =
    process.env.GEMINI_MODEL ||
    'gemini-3.8-flash';

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
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
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    const message =
      data &&
      data.error &&
      data.error.message
        ? data.error.message
        : `HTTP ${response.status}`;

    const error =
      new Error(
        `${model}: ${message}`
      );

    error.status =
      response.status === 429 ||
      response.status >= 500
        ? 503
        : response.status;

    throw error;
  }

  const text =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts
      ? data.candidates[0].content.parts
          .map(
            (part) =>
              part.text || ''
          )
          .join('')
      : '';

  if (!text.trim()) {
    const error =
      new Error(
        'Gemini no devolvió contenido.'
      );

    error.status = 503;

    throw error;
  }

  return {
    text:
      stripMarkdown(text),

    model
  };
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/api/health',
  (req, res) => {
    const library =
      readLibrary();

    res.json({
      ok: true,

      app:
        'Edu.sistem Pro IA',

      version:
        '2.3-SaaS',

      geminiConfigured:
        Boolean(
          process.env.GEMINI_API_KEY
        ),

      supabaseConfigured:
        Boolean(
          SUPABASE_URL &&
          SUPABASE_SERVICE_ROLE_KEY
        ),

      bibliotecaArgentina:
        true,

      provincias:
        library.provincias &&
        typeof library.provincias ===
          'object'
          ? Object.keys(
              library.provincias
            ).length
          : 0,

      categorias:
        Array.isArray(
          library.categorias
        )
          ? library.categorias.length
          : 0,

      planes:
        PLAN_LIMITS
    });
  }
);

/* =========================================================
   BIBLIOTECA
========================================================= */

app.get(
  '/api/biblioteca',
  (req, res) => {
    res.json(
      readLibrary()
    );
  }
);

/* =========================================================
   CUENTA
========================================================= */

app.get(
  '/api/cuenta',
  async (req, res) => {
    try {
      const user =
        await authenticatedUser(
          req
        );

      const profile =
        await getProfile(
          user.id,
          user.email
        );

      const limit =
        Number(
          profile.generations_limit
        ) ||
        PLAN_LIMITS.gratis;

      const used =
        Number(
          profile.generations_used
        ) || 0;

      res.json({
        ok: true,

        user: {
          id: user.id,
          email: user.email
        },

        profile: {
          ...profile,

          generations_used:
            used,

          generations_limit:
            limit,

          /*
            Compatibilidad con frontend antiguo.
          */
          generation_limit:
            limit,

          remaining:
            Math.max(
              0,
              limit - used
            )
        }
      });
    } catch (error) {
      console.error(
        'Error /api/cuenta:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          'No se pudo consultar la cuenta.'
      });
    }
  }
);

/* =========================================================
   GENERAR
========================================================= */

app.post(
  '/api/generar',

  upload.array(
    'materiales',
    2
  ),

  async (req, res) => {
    let userId = null;

    let generationConsumed =
      false;

    try {
      /*
        1. Autenticación
      */

      const user =
        await authenticatedUser(
          req
        );

      userId =
        user.id;

      /*
        2. Datos del formulario
      */

      const {
        provincia,
        tipo,
        nivel,
        grado,
        area,
        tema,
        duracion,
        indicaciones
      } =
        req.body || {};

      /*
        3. Biblioteca
      */

      const categorias =
        Array.isArray(
          req.body
            ?.bibliotecaCategorias
        )
          ? req.body
              .bibliotecaCategorias
          : req.body
                ?.bibliotecaCategorias
            ? [
                req.body
                  .bibliotecaCategorias
              ]
            : [];

      /*
        4. Validación
      */

      if (
        !provincia ||
        !tipo ||
        !nivel ||
        !grado ||
        !area ||
        !tema
      ) {
        return res
          .status(400)
          .json({
            error:
              'Completá provincia, tipo, nivel, grado/curso, área/materia y tema.'
          });
      }

      /*
        5. Consumir generación
           ANTES de llamar a Gemini.
      */

      const usage =
        await consumeGeneration(
          userId
        );

      generationConsumed =
        true;

      /*
        6. Materiales
      */

      const files =
        req.files || [];

      const extracted = [];

      for (
        const file of files
      ) {
        const text =
          await extractFileText(
            file
          );

        extracted.push({
          name:
            file.originalname,

          text:
            text.slice(
              0,
              90000
            )
        });
      }

      /*
        7. Tipos de trabajo
      */

      const typeNames = {
        anual:
          'Planificación anual',

        secuencia:
          'Secuencia didáctica',

        proyecto:
          'Proyecto educativo',

        rubrica:
          'Rúbrica de evaluación'
      };

      /*
        8. Contextos
      */

      const libraryContext =
        buildLibraryContext(
          categorias
        );

      const provinceContext =
        buildProvinceContext(
          provincia
        );

      const materialsContext =
        extracted.length
          ? extracted
              .map(
                (item) =>
                  `MATERIAL DEL DOCENTE: ${item.name}\n${item.text}`
              )
              .join('\n\n')
          : 'No se adjuntaron materiales del docente.';

      /*
        9. Prompt
      */

      const prompt = `
Sos Edu.sistem Pro IA, un asistente inteligente para docentes de Argentina.

La provincia seleccionada es:

${provincia}

Adaptá la propuesta al contexto educativo y curricular de esa jurisdicción cuando corresponda.

No inventes normativa ni documentos oficiales.

No atribuyas contenidos a organismos oficiales si no aparecen en la información proporcionada.

TIPO DE TRABAJO:

${typeNames[tipo] || tipo}

DATOS DEL DOCENTE:

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
- Evitá información inventada.
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

No agregues introducciones innecesarias.

Entregá directamente el trabajo docente.
`;

      /*
        10. Gemini
      */

      const result =
        await geminiGenerate(
          prompt
        );

      /*
        11. Respuesta
      */

      res.json({
        ok: true,

        texto:
          result.text,

        modelo:
          result.model,

        materialesUsados:
          extracted.map(
            (item) =>
              item.name
          ),

        bibliotecaCategorias:
          categorias,

        provincia,

        generations_used:
          usage.generations_used,

        generations_limit:
          usage.generations_limit,

        /*
          Compatibilidad.
        */
        generation_limit:
          usage.generations_limit,

        remaining:
          usage.remaining
      });

    } catch (error) {

      console.error(
        'Error /api/generar:',
        error
      );

      /*
        Si Gemini falla después de
        consumir la generación,
        intentamos devolverla.
      */

      if (
        generationConsumed &&
        userId
      ) {
        await releaseGeneration(
          userId
        );
      }

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            'No se pudo generar el trabajo.'
        });
    }
  }
);

/* =========================================================
   RUTA PRINCIPAL
========================================================= */

app.get(
  '*',
  (req, res) => {

    if (
      req.path.startsWith(
        '/api/'
      )
    ) {
      return res
        .status(404)
        .json({
          error:
            'Endpoint no encontrado.'
        });
    }

    res.sendFile(
      path.join(
        ROOT,
        'index.html'
      )
    );
  }
);

/* =========================================================
   SERVIDOR
========================================================= */

if (
  require.main === module
) {
  app.listen(
    PORT,
    () => {
      console.log(
        `Edu.sistem Pro IA escuchando en ${PORT}`
      );
    }
  );
}

module.exports = app;
