EDU.SISTEM PRO IA — V1 GEMINI / VERCEL

Cambios:
- Se eliminó la creación de /uploads que provocaba el error ENOENT en Vercel.
- Se agregó integración real con Gemini mediante GEMINI_API_KEY.
- La clave nunca se guarda en este proyecto.
- Se agregó /api/health para comprobar el servidor.
- Se mantiene la interfaz simple de la versión V1.
- El campo “¿Cómo querés que lo realice?” se envía a Gemini como instrucciones.

VERCEL:
Variable de entorno:
GEMINI_API_KEY = tu clave de Google AI Studio

No subas la clave a GitHub.

IMPORTANTE:
Esta V1 no guarda archivos de forma persistente en /uploads. Si después se incorpora subida de Diseños Curriculares/materiales, deberá utilizar almacenamiento persistente o un servicio de archivos, no el filesystem local de Vercel.
