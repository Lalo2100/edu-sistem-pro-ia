const multer=require('multer');
const pdfParse=require('pdf-parse');
const mammoth=require('mammoth');
const upload=multer({storage:multer.memoryStorage(),limits:{files:5,fileSize:8*1024*1024}});
const MODELS=(process.env.GEMINI_MODEL||'gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.5-flash,gemini-3.6-flash').split(',').map(x=>x.trim()).filter(Boolean);
function runUpload(req,res){return new Promise((resolve,reject)=>upload.array('materiales',5)(req,res,e=>e?reject(e):resolve()));}
async function extract(file){
  const n=(file.originalname||'').toLowerCase(), b=file.buffer;
  if(n.endsWith('.pdf')){const x=await pdfParse(b);return x.text||'';}
  if(n.endsWith('.docx')){const x=await mammoth.extractRawText({buffer:b});return x.value||'';}
  if(/\.(txt|md|csv|html|htm)$/.test(n))return b.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ');
  throw new Error('Formato no compatible: '+file.originalname);
}
const buildPrompt=(d,materials)=>`Sos Edu.sistem pro ia, asistente especializado en planificación educativa para docentes argentinos. Generá solamente el documento final, profesional y listo para copiar a Word. Respetá nivel, grado, área, tema y duración. Tipo: ${d.tipo}
Nivel: ${d.nivel||''}
Grado/Curso: ${d.grado||''}
Área/Materia: ${d.area||''}
Tema: ${d.tema||''}
Duración: ${d.duracion||''}
Indicaciones del docente: ${d.indicaciones||'Propuesta completa y adecuada al nivel.'}
Usá los materiales de referencia enviados como contexto. No inventes normativa oficial.
MATERIALES DE REFERENCIA:
${materials||'(No se enviaron materiales.)'}`;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Headers','Content-Type');
 res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
 const key=process.env.GEMINI_API_KEY;if(!key)return res.status(503).json({error:'GEMINI_API_KEY no está configurada en Vercel.'});
 try{
   await runUpload(req,res);
   const d=req.body||{};
   if(typeof d.tipo==='string')d.tipo=d.tipo.trim();
   if(!d.tipo||!String(d.tema||'').trim())return res.status(400).json({error:'Indicá el tipo de trabajo y el tema.'});
   let materials='', used=[];
   for(const f of (req.files||[])){try{const t=await extract(f);if(t.trim()){materials+=`\n--- ${f.originalname} ---\n${t.slice(0,30000)}`;used.push(f.originalname)}}catch(e){}}
   let last='';
   for(const model of MODELS){
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:buildPrompt(d,materials.slice(0,90000))}]}],generationConfig:{maxOutputTokens:12000}})});
      const b=await r.json().catch(()=>({}));
      if(!r.ok){last=b?.error?.message||`HTTP ${r.status}`;continue}
      const texto=(b?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('\n').trim();
      if(texto)return res.json({ok:true,texto,modelo,materialesUsados:used});
      last='Gemini no devolvió contenido.';
    }catch(e){last=e.message}
   }
   return res.status(502).json({error:`Gemini no pudo generar el documento. ${last}`});
 }catch(e){return res.status(400).json({error:e.message||'No se pudo procesar la solicitud.'});}
};