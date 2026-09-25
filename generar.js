const MODELS = (
  process.env.GEMINI_MODEL ||
  'gemini-2.5-flash,gemini-2.5-flash-lite'
)
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

function cleanText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n')
    .trim();
}

function buildPrompt(d, materials) {
  return `Sos Edu.sistem pro ia, asistente especializado en planificación educativa para docentes argentinos.

Generá solamente el documento final, profesional y listo para copiar a Word.

DATOS DEL TRABAJO
Tipo: ${d.tipo || ''}
Nivel: ${d.nivel || ''}
Grado/Curso: ${d.grado || ''}
Área/Materia: ${d.area || ''}
Tema: ${d.tema || ''}
Duración: ${d.duracion || ''}

INDICACIONES DEL DOCENTE:
${d.indicaciones || 'Propuesta completa y adecuada al nivel.'}

MATERIALES DE REFERENCIA:
Utilizá los materiales proporcionados como contexto cuando sean pertinentes.
No inventes normativa oficial.
No afirmes que algo pertenece a un diseño curricular si no aparece en los materiales.

${materials || '(No se enviaron materiales.)'}

IMPORTANTE:
- Adaptá el contenido al nivel, grado/curso y área indicados.
- Mantené una estructura clara y profesional.
- No agregues explicaciones sobre cómo generaste el documento.
- Entregá directamente el documento final.`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Método no permitido.'
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY no está configurada en Vercel.'
    });
  }

  try {
    const d = req.body || {};

    if (typeof d.tipo === 'string') d.tipo = d.tipo.trim();

    if (!d.tipo || !String(d.tema || '').trim()) {
      return res.status(400).json({
        error: 'Indicá el tipo de trabajo y el tema.'
      });
    }

    let materials = '';

    /*
     * Los materiales ahora llegan como TEXTO.
     * Ya no recibimos PDF/DOCX completos en esta función.
     */
    if (Array.isArray(d.materiales)) {
      for (const material of d.materiales) {
        if (!material) continue;

        const nombre = material.nombre || 'Material';
        const categoria = material.categoria || '';
        const texto = cleanText(material.texto);

        if (!texto) continue;

        materials += `

--- ${nombre}${categoria ? ` | ${categoria}` : ''} ---
${texto}`;
      }
    }

    /*
     * También aceptamos un único bloque de texto,
     * por compatibilidad.
     */
    if (!materials && d.materialesTexto) {
      materials = cleanText(d.materialesTexto);
    }

    /*
     * Protección para que el prompt no crezca indefinidamente.
     */
    materials = materials.slice(0, 90000);

    let last = '';

    for (const model of MODELS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: buildPrompt(d, materials)
                    }
                  ]
                }
              ],
              generationConfig: {
                maxOutputTokens: 12000
              }
            })
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          last =
            data?.error?.message ||
            `HTTP ${response.status}`;
          continue;
        }

        const texto = (
          data?.candidates?.[0]?.content?.parts || []
        )
          .map(p => p.text || '')
          .join('\n')
          .trim();

        if (texto) {
          return res.json({
            ok: true,
            texto,
            modelo: model
          });
        }

        last = 'Gemini no devolvió contenido.';
      } catch (e) {
        last = e.message || 'Error de conexión con Gemini.';
      }
    }

    return res.status(502).json({
      error: `Gemini no pudo generar el documento. ${last}`
    });

  } catch (e) {
    return res.status(400).json({
      error: e.message || 'No se pudo procesar la solicitud.'
    });
  }
};
