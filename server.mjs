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
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const modes = new Set(['Professional','Friendly','Funny','Short','Apologetic','Romantic','JARVIS']);
const allowedOrigins = new Set([
  'https://jonathanolum415-lab.github.io',
  'https://jarvisreply-dvh8yfjn.manus.space',
  'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'
]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0, tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > maxBodyBytes) { tooLarge = true; raw = ''; } else if (!tooLarge) raw += chunk; });
    req.on('end', () => { if (tooLarge) return reject(Object.assign(new Error('Request body is too large.'), { status:413 })); try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status:400 })); } });
    req.on('error', reject);
  });
}
function cleanReply(content) {
  const lines = content.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0]?.startsWith('```')) lines.shift(); if (lines.at(-1)?.startsWith('```')) lines.pop();
  const text = lines.join('\n');
  try { const parsed = JSON.parse(text); if (typeof parsed.reply === 'string' && parsed.reply.trim()) return { reply:parsed.reply.trim(), explanation:typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '' }; } catch {}
  const explanationIndex = lines.findIndex(line => /^explanation\s*:/i.test(line));
  const explanationLine = explanationIndex >= 0 ? lines[explanationIndex] : '';
  const replyLines = (explanationIndex >= 0 ? lines.slice(0, explanationIndex) : lines).filter(line => !/^explanation\s*:/i.test(line));
  const reply = replyLines.join(' ').replace(/^reply\s*:\s*/i, '').replace(/^(?:option\s*)?\d+\s*[:.)-]\s*/i, '').trim();
  return { reply, explanation:explanationLine ? explanationLine.replace(/^explanation\s*:\s*/i, '').trim() : '' };
}

async function generateReplies(input) {
  if (!apiBase || !apiKey) {
    throw Object.assign(new Error('The managed AI service is not available to this server yet.'), { status:503 });
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Request must be a JSON object.'), { status:400 });
  const mode = String(input.mode || 'JARVIS');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const turns = Array.isArray(input.turns) ? input.turns.slice(-12) : [];
  const context = Array.isArray(input.context) ? input.context.slice(0, 12) : [];
  if (!modes.has(mode)) throw Object.assign(new Error('Unknown response tone.'), { status:400 });
  if (!message || message.length > maxMessageChars) throw Object.assign(new Error('Message must be between 1 and ' + maxMessageChars + ' characters.'), { status:400 });

  const transcript = turns.filter(turn => turn && typeof turn === 'object' && !turn.assistant && !turn.draft).map(turn => `${String(turn.from || 'Contact').slice(0,40)}: ${String(turn.text || '').slice(0,1500)}`).join('\n');
  const system = [
    'You are JARVIS, a discreet reply co-pilot.',
    'Generate replies only. Never claim to send a message, and never invent facts.',
    `Selected response mode: ${mode}. Match that tone while staying natural and concise.`,
    'Write one polished reply as if you are the user responding directly. Make it natural, warm, and specific to the incoming message and conversation. Do not mention JARVIS, AI, or these instructions.',
    'After the reply, return one line beginning with EXPLANATION: explaining briefly how the thread context shaped it.',
    'Do not number the reply, use markdown bullets, or put quotation marks around it.'
  ].join(' ');
  const user = [
    `Incoming message to answer: ${message}`,
    `Conversation transcript:\n${transcript || '(new thread)'}`,
    `Tracked context signals: ${context.join(', ') || '(none)'}`
  ].join('\n\n');

  let upstream;
  try { upstream = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(25000)
  }); } catch { throw Object.assign(new Error('AI provider is unreachable or timed out.'), { status:503 }); }

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || payload.error) {
    const reason = payload?.error?.message || `AI service returned HTTP ${upstream.status}.`;
    throw Object.assign(new Error(reason), { status:502 });
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The AI service returned no reply text.');
  }

  const parsed = cleanReply(content);
  if (!parsed.reply || parsed.reply.length < 2) {
    throw Object.assign(new Error('The AI service returned no usable reply.'), { status:502 });
  }
  return { ...parsed, provider: 'managed-llm' };
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidates = [path.resolve(staticRoot, relative), path.resolve(staticRoot, 'public', relative)];
  for (const candidate of candidates) {
    if (!candidate.startsWith(staticRoot + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const body = await readFile(candidate);
      res.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(candidate)] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
      return;
    } catch {
      // Try the public directory when the root path is not present.
    }
  }
  res.writeHead(404);
  res.end('Not found');
}

function rateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now(), entry = rateLimits.get(ip);
  if (!entry || now - entry.start >= RATE_LIMIT_WINDOW_MS) { rateLimits.set(ip,{start:now,count:1}); return false; }
  entry.count += 1; return entry.count > RATE_LIMIT_MAX;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); res.setHeader('Vary','Origin'); }
  if (url.pathname.startsWith('/api/') && origin && !allowedOrigins.has(origin)) { sendJson(res,403,{error:'Origin not allowed.'}); return; }
  try {
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) { res.writeHead(origin && allowedOrigins.has(origin) ? 204 : 403); res.end(); return; }
    if (url.pathname === '/api/health' && req.method === 'GET') { sendJson(res,200,{ok:true,aiConfigured:Boolean(apiBase && apiKey)}); return; }
    if (url.pathname === '/api/reply' && req.method === 'POST') { const contentType=req.headers['content-type']||''; if (!contentType.toLowerCase().includes('application/json')) { sendJson(res,415,{error:'Content-Type must be application/json.'}); return; } if (rateLimit(req)) { sendJson(res,429,{error:'Rate limit exceeded. Wait a minute and try again.'}); return; } const input=await readJson(req), result=await generateReplies(input); sendJson(res,200,result); return; }
    if (req.method === 'GET') { await serveStatic(req,res,url.pathname); return; }
    sendJson(res,405,{error:'Method not allowed.'});
  } catch (error) { sendJson(res,error.status||500,{error:error.message||'Request failed.'}); }
});
setInterval(()=>{const now=Date.now();for(const[ip,entry]of rateLimits)if(now-entry.start>RATE_LIMIT_WINDOW_MS)rateLimits.delete(ip);},RATE_LIMIT_WINDOW_MS).unref();
server.requestTimeout=30000; server.headersTimeout=10000;
server.listen(port, '0.0.0.0', () => {
  console.log(`JARVIS server listening on 0.0.0.0:${port}`);
});
