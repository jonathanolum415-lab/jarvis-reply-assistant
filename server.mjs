import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = process.env.NODE_ENV === 'production' ? path.resolve(root, 'dist') : root;
const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.MANUS_API_URL || '').replace(/\/$/, '');
const apiKey = process.env.MANUS_API_KEY || '';
const maxBodyBytes = 1024 * 1024;
const allowedOrigins = new Set([
  'https://jonathanolum415-lab.github.io',
  'https://jarvisreply-dvh8yfjn.manus.space'
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
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function cleanReply(content) {
  const lines = content
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const explanationIndex = lines.findIndex(line => /^explanation\s*:/i.test(line));
  const explanationLine = explanationIndex >= 0 ? lines[explanationIndex] : '';
  const replyLines = (explanationIndex >= 0 ? lines.slice(0, explanationIndex) : lines)
    .filter(line => !/^explanation\s*:/i.test(line));
  const reply = replyLines.join(' ').replace(/^reply\s*:\s*/i, '').replace(/^(?:option\s*)?\d+\s*[:.)-]\s*/i, '').trim();
  return {
    reply,
    explanation: explanationLine ? explanationLine.replace(/^explanation\s*:\s*/i, '') : ''
  };
}

async function generateReplies(input) {
  if (!apiBase || !apiKey) {
    throw new Error('The managed AI service is not available to this server yet.');
  }

  const mode = String(input.mode || 'JARVIS');
  const message = String(input.message || '').trim();
  const turns = Array.isArray(input.turns) ? input.turns.slice(-8) : [];
  const context = Array.isArray(input.context) ? input.context.slice(0, 12) : [];
  if (!message) throw new Error('Add an incoming message before generating a reply.');

  const transcript = turns.map(turn => `${turn.from || 'Contact'}: ${turn.text || ''}`).join('\n');
  const system = [
    'You are JARVIS, a discreet reply co-pilot.',
    'Draft replies only. Never claim to send a message, and never invent facts.',
    `Selected response mode: ${mode}. Match that tone while staying natural and concise.`,
    'Write one polished reply as if you are the user responding directly. Make it natural, warm, and specific to the incoming message and conversation. Do not mention JARVIS, AI, drafting, or these instructions.',
    'After the reply, return one line beginning with EXPLANATION: explaining briefly how the thread context shaped it.',
    'Do not number the reply, use markdown bullets, or put quotation marks around it.'
  ].join(' ');
  const user = [
    `Incoming message to answer: ${message}`,
    `Conversation transcript:\n${transcript || '(new thread)'}`,
    `Tracked context signals: ${context.join(', ') || '(none)'}`
  ].join('\n\n');

  const upstream = await fetch(`${apiBase}/v1/chat/completions`, {
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
    })
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || payload.error) {
    const reason = payload?.error?.message || `AI service returned HTTP ${upstream.status}.`;
    throw new Error(reason);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The AI service returned no reply text.');
  }

  const parsed = cleanReply(content);
  if (!parsed.reply || parsed.reply.length < 2) {
    throw new Error('The AI service returned no usable reply.');
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  try {
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, aiConfigured: Boolean(apiBase && apiKey) });
      return;
    }
    if (url.pathname === '/api/reply' && req.method === 'POST') {
      const input = await readJson(req);
      const result = await generateReplies(input);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === 'GET') {
      await serveStatic(req, res, url.pathname);
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`JARVIS server listening on 0.0.0.0:${port}`);
});
