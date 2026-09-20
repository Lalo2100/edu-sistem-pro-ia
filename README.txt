EDU.SISTEM PRO IA — V1 CON GEMINI Y MATERIALES

Esta versión toma Educ.Pro_IA_V1_SIMPLE_SIN_MODELOS.zip como base y la convierte en
Edu.sistem pro ia.

INCLUYE
- Gemini API mediante GEMINI_API_KEY.
- Materiales de referencia: PDF, Word DOCX, TXT, MD, CSV y HTML.
- Selección de los materiales que se usarán en cada generación.
- Diseños Curriculares, documentos de actualización curricular, programas y ejemplos
  pueden cargarse como materiales de referencia.
- Campo libre para que el docente explique cómo quiere el trabajo.
- Planificación anual, proyectos, secuencias, evaluaciones, material educativo,
  efemérides y actos escolares.
- Sin sección "Modelos" ni "Subir modelos".
- Diseño simple y responsive para celular.
- La clave Gemini queda solamente en el servidor, nunca en el navegador.

CONFIGURACIÓN LOCAL
1. Abrí una terminal dentro de esta carpeta.
2. Ejecutá: npm install
3. Definí GEMINI_API_KEY:
   Windows PowerShell: $env:GEMINI_API_KEY="TU_CLAVE"
   CMD: set GEMINI_API_KEY=TU_CLAVE
4. Ejecutá: npm start
5. Abrí http://localhost:3021

CONFIGURACIÓN EN RENDER
- Environment -> Add Environment Variable
- Key: GEMINI_API_KEY
- Value: tu clave de Gemini
- Opcional: GEMINI_MODEL = gemini-2.5-flash
- Guardá y hacé un nuevo deploy.

IMPORTANTE
No pongas la clave dentro de index.html ni la subas a GitHub. La API de Gemini se
llama desde server.js mediante el encabezado x-goog-api-key.
