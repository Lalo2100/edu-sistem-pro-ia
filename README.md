# Edu.sistem Pro IA — V7 prueba funcional

Versión preparada para una prueba real en Vercel.

## Incluye
- Logo integrado directamente en la interfaz (no depende de `/logo.svg`).
- Planificación anual, secuencia didáctica, proyecto y rúbrica.
- Materiales de referencia: PDF, DOCX, TXT, MD, CSV y HTML.
- Generación mediante Gemini en servidor; la clave nunca se expone al navegador.
- Descarga TXT y Word (.doc) y opción Imprimir / PDF desde el navegador.
- Estado de conexión y errores visibles.
- Compatible con Vercel sin carpeta `uploads` ni almacenamiento permanente.

## Variables de entorno en Vercel
Obligatoria:
- `GEMINI_API_KEY` = tu clave de Google AI Studio

Opcional:
- `GEMINI_MODEL` = `gemini-3.5-flash-lite`

Si no definís `GEMINI_MODEL`, el servidor prueba automáticamente:
1. gemini-3.5-flash-lite
2. gemini-3.8-flash
3. gemini-3.5-flash
4. gemini-3.6-flash

## Prueba
1. Subir todos los archivos del ZIP al repositorio de GitHub.
2. En Vercel, Redeploy.
3. Abrir `/api/health`. Debe mostrar `ok:true` y `geminiConfigured:true`.
4. En la página, pulsar «Completar ejemplo» y luego «Crear con Gemini».
5. Comprobar que aparece el resultado y probar Copiar, Descargar Word e Imprimir / PDF.

## Importante
Esta versión usa primero modelos Gemini 3.x recomendados por Google para proyectos nuevos y no usa Gemini 2.0 como respaldo. Google indica que el acceso a Gemini 2.5 está limitado para ciertos proyectos nuevos.
