const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// Bloque de captura total de errores de inicio
try {
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(ROOT));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, message: 'Edu.sistem Pro IA funcionando en modo diagnóstico' });
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Endpoint no encontrado.' });
    }
    const indexPath = path.join(ROOT, 'index.html');
    res.sendFile(indexPath);
  });

} catch (initError) {
  console.error('🔥 ERROR FATAL AL INICIALIZAR EL SERVIDOR:', initError.stack || initError);
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor local corriendo en puerto ${PORT}`);
  });
}

module.exports = app;
