import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = process.env.NODE_ENV === 'production' ? path.resolve(root, 'dist') : root;
const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.MANUS_API_URL || '').replace(/\\/$/, '');
const apiKey = process.env.MANUS_API_KEY || '';
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGE_CHARS = 4000;
const allowedOrigins = new Set([
  'https://jonathanolum415-lab.github.io',
  'https://jarvisreply-dvh8yfjn.manus.space',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
const rateLimits = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const modes = new Set(['Professional', 'Friendly', 'Funny', 'Short', 'Apologetic', 'Romantic', 'JARVIS']);
const mimeTypes = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' };

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(body) });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0, tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) { tooLarge = true; raw = ''; }
      else if (!tooLarge) raw += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request body is too large.'), { status:413 }));
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status:400 })); }
    });
    req.on('error', reject);
  });
}
function rateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown'; // Avoid trusting spoofable forwarded headers.
  const now = Date.now(), entry = rateLimits.get(ip);
  if (!entry || now - entry.start >= RATE_WINDOW_MS) { rateLimits.set(ip, { start:now, count:1 }); return false; }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}
function parseOutput(content) {
  const trimmed = content.trim().replace(/^\\s*\\`\\`\\`(?:json)?\\s*/i, '').replace(/\\s*\\`\\`\\`\\s*$/, '');
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj.reply === 'string' && obj.reply.trim()) return { reply:obj.reply.trim(), explanation:typeof obj.explanation === 'string' ? obj.explanation.trim() : '' };
  } catch {}
  const lines = trimmed.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
  const replyLine = lines.find(line => /^reply\\s*:/i.test(line)) || lines.find(line => !/^explanation\\s*:/i.test(line));
  const explanationLine = lines.find(line => /^explanation\\s*:/i.test(line));
  const reply = replyLine?.replace(/^reply\\s*:\\s*/i, '').trim();
  if (reply) return { reply, explanation:explanationLine ? explanationLine.replace(/^explanation\\s*:\\s*/i, '').trim() : '' };
  throw Object.assign(new Error('AI output could not be parsed into a reply.'), { status:502 });
}
async function generateReplies(input) {
  if (!apiBase || !apiKey) throw Object.assign(new Error('AI service is not configured on the server.'), { status:503 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Request must be a JSON object.'), { status:400 });
  const mode = String(input.mode || 'JARVIS');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!modes.has(mode)) throw Object.assign(new Error('Unknown response tone.'), { status:400 });
  if (!message || message.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error(`Message must be between 1 and ${MAX_MESSAGE_CHARS} characters.), { status:400 });
  const turns = Array.isArray(input.turns) ? input.turns.slice(-12) : [];
  const context = Array.isArray(input.context) ? input.context.slice(0,12) : [];
  const transcript = turns.filter(t => t && typeof t === 'object' && !t.assistant && !t.draft)
    .map(t => `${String(t.from || 'Contact').slice(0,40)}: ${String(t.text || '').slice(0,1500)}`).join('\\n');
  const system = [
    'You are JARVIS, a discreet reply co-pilot.',
    'Draft replies only. Never claim to send messages or invent commitments or facts.',
    `Tone: ${mode}. Keep the reply natural, concise, and useful.`,
    'Return only valid JSON: {"reply":"...","explanation":"..."}. Do not include extra keys.'
  ].join(' ');
  const user = `Incoming message: ${message}\\nConversation (messages only):\\n${transcript || '(no prior messages)'}\\nContext: ${context.map(x => String(x).slice(0,160)).join('; ') || '(none)'}`;
  let upstream;
  try {
    upstream = await fetch(`${apiBase}/v1/chat/completions`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ messages:[{role:'system',content:system},{role:'user',content:user}] }),
      signal:AbortSignal.timeout(25_000)
    });
  } catch {
    throw Object.assign(new Error('AI provider is unreachable or timed out.'), { status:503 });
  }
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || payload.error) throw Object.assign(new Error(payload?.error?.message || 'AI provider returned an error.'), { status:502 });
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('AI provider returned an empty response.'), { status:502 });
  return { ...parseOutput(content), provider:'managed-llm' };
}
async function serveStatic(res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { res.writeHead(400); res.end('Bad path'); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\\/+/, '');
  for (const candidate of [path.resolve(staticRoot, relative), path.resolve(staticRoot, 'public', relative)]) {
    if (candidate !== staticRoot && !candidate.startsWith(staticRoot + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    try {
      const body = await readFile(candidate);
      res.writeHead(200, { 'Content-Type':mimeTypes[path.extname(candidate)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
      res.end(body); return;
    } catch {}
  }
  res.writeHead(404); res.end('Not found');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (url.pathname.startsWith('/api/') && origin && !allowedOrigins.has(origin)) { sendJson(res,403,{error:'Origin not allowed.'}); return; }
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) { res.writeHead(origin && allowedOrigins.has(origin) ? 204 : 403); res.end(); return; }
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') { sendJson(res,200,{ok:true,aiConfigured:Boolean(apiBase && apiKey)}); return; }
    if (url.pathname === '/api/reply' && req.method === 'POST') {
      if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { sendJson(res,415,{error:'Content-Type must be application/json.'}); return; }
      if (rateLimit(req)) { sendJson(res,429,{error:'Rate limit exceeded. Wait a minute and try again.'}); return; }
      const input = await readJson(req), result = await generateReplies(input);
      sendJson(res,200,result); return;
    }
    if (req.method === 'GET') { await serveStatic(res,url.pathname); return; }
    sendJson(res,405,{error:'Method not allowed.'});
  } catch (error) { sendJson(res,error.status || 500,{error:error.message || 'Request failed.'}); }
});
setInterval(() => { const now=Date.now(); for (const [ip,entry] of rateLimits) if (now-entry.start > RATE_WINDOW_MS) rateLimits.delete(ip); }, RATE_WINDOW_MS).unref();
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port,'0.0.0.0',() => console.log(`JARVIS server listening on 0.0.0.0:${port}`));
