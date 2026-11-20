import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = process.env.NODE_ENV === 'production' ? path.resolve(root, 'dist') : root;
const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.MANUS_API_URL || '').replace(/\/$/, '');
const apiKey = process.env.MANUS_API_KEY || '';
const maxBodyBytes = 32 * 1024;
const maxMessageChars = 4000;
const allowedOrigins = new Set([
  'https://jonathanolum415-lab.github.io',
  'https://jarvisreply-dvh8yfjn.manus.space'
]);
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const modes = new Set(['Professional','Friendly','Funny','Short','Apologetic','Romantic','JARVIS']);
const mimeTypes = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon' };

function sendJson(res,status,payload) {
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve,reject)=>{
    let raw='',size=0;
    req.setEncoding('utf8');
    req.on('data',chunk=>{
      size+=Buffer.byteLength(chunk);
      if(size>maxBodyBytes){reject(Object.assign(new Error('Request body is too large.'),{status:413}));req.destroy();return;}
      raw+=chunk;
    });
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(Object.assign(new Error('Request body must be valid JSON.'),{status:400}));}});
    req.on('error',reject);
  });
}
function rateLimit(req) {
  // Use the direct socket address; do not trust client-supplied X-Forwarded-For.
  const ip=req.socket.remoteAddress||'unknown';
  const now=Date.now(),entry=rateLimits.get(ip);
  if(!entry||now-entry.start>=RATE_LIMIT_WINDOW_MS){rateLimits.set(ip,{start:now,count:1});return false;}
  entry.count++;return entry.count>RATE_LIMIT_MAX;
}
function parseOutput(content) {
  const trimmed=content.trim().replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
  try {
    const parsed=JSON.parse(trimmed);
    if(Array.isArray(parsed.suggestions)&&parsed.suggestions.length===3&&parsed.suggestions.every(x=>typeof x==='string'&&x.trim())) return {suggestions:parsed.suggestions.map(x=>x.trim()),explanation:typeof parsed.explanation==='string'?parsed.explanation:''};
  } catch {}
  const lines=trimmed.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const options=lines.filter(line=>/^option\s*[1-3]\s*[:.)-]/i.test(line)).map(line=>line.replace(/^option\s*[1-3]\s*[:.)-]\s*/i,'').trim()).filter(x=>x.length>0);
  const exp=lines.find(line=>/^explanation\s*:/i.test(line));
  if(options.length===3) return {suggestions:options,explanation:exp?exp.replace(/^explanation\s*:\s*/i,''):''};
  throw new Error('AI output could not be parsed into exactly three replies.');
}
async function generateReplies(input) {
  if(!apiBase||!apiKey) throw Object.assign(new Error('AI service is not configured on the server.'),{status:503});
  if(!input||typeof input!=='object'||Array.isArray(input)) throw Object.assign(new Error('Request must be a JSON object.'),{status:400});
  const mode=String(input.mode||'JARVIS');
  const message=typeof input.message==='string'?input.message.trim():'';
  if(!modes.has(mode)) throw Object.assign(new Error('Unknown response tone.'),{status:400});
  if(!message||message.length>maxMessageChars) throw Object.assign(new Error(`Message must be between 1 and ${maxMessageChars} characters.),{status:400});
  const turns=Array.isArray(input.turns)?input.turns.slice(-12):[];
  const context=Array.isArray(input.context)?input.context.slice(0,12):[];
  const transcript=turns.filter(t=>t&&typeof t==='object'&&!t.assistant&&!t.draft).map(t=>`${String(t.from||'Contact').slice(0,40)}: ${String(t.text||'').slice(0,2000)}`).join('\n');
  const system=[
    'You are JARVIS, a discreet reply co-pilot.',
    'Draft replies only. Never claim to send messages or invent commitments/facts.',
    `Tone: ${mode}. Keep options natural and useful.`,
    'Return only valid JSON: {"suggestions":["...","...","..."],"explanation":"..."}. Exactly three concise replies. No extra keys.'
  ].join(' ');
  const user=`Incoming message: ${message}\nConversation (only messages actually sent/received):\n${transcript||'(no prior messages)'}\nContext signals: ${context.map(x=>String(x).slice(0,160)).join('; ')||'(none)'}`;
  let upstream;
  try {
    upstream=await fetch(`${apiBase}/v1/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:user}]},),signal:AbortSignal.timeout(25000)});
  } catch(error) { throw Object.assign(new Error('AI provider is unreachable or timed out.'),{status:503}); }
  const payload=await upstream.json().catch(()=>({}));
  if(!upstream.ok||payload.error) throw Object.assign(new Error(payload?.error?.message||'AI provider returned an error.'),{status:502});
  const content=payload?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim()) throw Object.assign(new Error('AI provider returned an empty response.'),{status:502});
  const parsed=parseOutput(content);
  return {...parsed,provider:'managed-llm'};
}
async function serveStatic(res,pathname) {
  const rel=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidates=[path.resolve(staticRoot,rel),path.resolve(staticRoot,'public',rel)];
  for(const candidate of candidates) {
    if(!candidate.startsWith(staticRoot+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    try{const body=await readFile(candidate);res.writeHead(200,{'Content-Type':mimeTypes[path.extname(candidate)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);return;}catch{}
  }
  res.writeHead(404);res.end('Not found');
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  const origin=req.headers.origin;
  if(origin&&allowedOrigins.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Vary','Origin');}
  if(url.pathname.startsWith('/api/')&&origin&&!allowedOrigins.has(origin)){sendJson(res,403,{error:'Origin not allowed.'});return;}
  if(req.method==='OPTIONS'&&url.pathname.startsWith('/api/')){res.writeHead(origin&&allowedOrigins.has(origin)?204:403);res.end();return;}
  try{
    if(url.pathname==='/api/health'&&req.method==='GET'){sendJson(res,200,{ok:true,aiConfigured:Boolean(apiBase&&apiKey)});return;}
    if(url.pathname==='/api/reply'&&req.method==='POST'){
      if(!req.headers['content-type']?.toLowerCase().includes('application/json')){sendJson(res,415,{error:'Content-Type must be application/json.'});return;}
      if(rateLimit(req)){sendJson(res,429,{error:'Rate limit exceeded. Wait a minute and try again.'});return;}
      const input=await readJson(req),result=await generateReplies(input);sendJson(res,200,result);return;
    }
    if(req.method==='GET'){await serveStatic(res,url.pathname);return;}
    sendJson(res,405,{error:'Method not allowed.'});
  }catch(error){sendJson(res,error.status||500,{error:error.message||'Request failed.'});}
});
setInterval(()=>{const now=Date.now();for(const [ip,entry] of rateLimits)if(now-entry.start>RATE_LIMIT_WINDOW_MS)rateLimits.delete(ip);},RATE_LIMIT_WINDOW_MS).unref();
server.requestTimeout=30000;
server.headersTimeout=10000;
server.listen(port,'0.0.0.0',()=>console.log(`JARVIS server listening on 0.0.0.0:${port}`));
