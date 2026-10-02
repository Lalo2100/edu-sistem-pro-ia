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

// --- INICIALIZACIÓN BLINDADA DE SUPABASE ---
let supabase = null;
try {
  const url = process.env.SUPABASE_URL || 'https://placeholder-url.supabase.co';
  const key = 
    process.env.SUPABASE_SERVICE_ROLE_KEY || 
    process.env.SUPABASE_SECRET_KEY || 
    process.env.SUPABASE_KEY || 
    'placeholder-key-safe';
  
  supabase = createClient(url, key);
  console.log('Cliente de Supabase inicializado correctamente.');
} catch (err) {
  console.error('Aviso de inicialización de Supabase:', err.message);
}

// --- CONFIGURACIÓN DE MERCADO PAGO ---
const mpAccessToken =
  process.env.MERCADOPAGO_ACCESS_TOKEN ||
  process.env.MP_ACCESS_TOKEN ||
  '';

// --- RUTAS DEL SISTEMA ---
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'Edu.sistem Pro IA',
    version: '2.2',
    supabaseConfigured: !!supabase,
    mercadopagoConfigured: !!mpAccessToken,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    bibliotecaArgentina: true
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Edu.sistem Pro IA funcionando correctamente'
  });
});

// --- ENTORNO LOCAL ---
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Servidor local corriendo en puerto ${PORT}`);
  });
}

// --- EXPORTACIÓN PARA VERCEL ---
module.exports = app;
