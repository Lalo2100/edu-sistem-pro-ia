# Edu.sistem Pro IA — versión nacional 2.0

Esta versión amplía la aplicación para trabajar por jurisdicción y mantiene Córdoba como biblioteca inicial.

## Archivos principales
- `server.js`: servidor Express + Gemini + carga de materiales.
- `public/index.html`: interfaz móvil.
- `biblioteca.json`: estructura de las 24 jurisdicciones y categorías.
- `package.json`: dependencias.

## Vercel
1. Subí estos archivos a tu repositorio.
2. En Vercel configurá `GEMINI_API_KEY` en Production.
3. Opcional: `GEMINI_MODEL=gemini-3.8-flash`.
4. El endpoint `/api/health` muestra `geminiConfigured:true` cuando la variable está disponible.

## Importante
La biblioteca no inventa documentos oficiales. Córdoba incluye referencias oficiales del portal Currículum Córdoba. Buenos Aires queda preparada para cargar sus documentos curriculares oficiales y luego hacer lo mismo con las demás jurisdicciones.
