import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
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

function cleanSuggestions(content) {
  const lines = content
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const options = lines
    .filter(line => !/^explanation\s*:/i.test(line))
    .map(line => line.replace(/^(?:option\s*)?\d+\s*[:.)-]\s*/i, '').trim())
    .filter(line => line.length > 12);

  const explanationLine = lines.find(line => /^explanation\s*:/i.test(line));
  return {
    suggestions: [...new Set(options)].slice(0, 3),
    explanation: explanationLine ? explanationLine.replace(/^explanation\s*:\s*/i, '') : ''
  };
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    if (isIP(mapped) === 4) return isPrivateAddress(mapped);
  }
  if (isIP(normalized) === 4) {
    const [first, second, third] = normalized.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224;
  }
  return normalized === '::' || normalized === '::1' ||
    normalized.startsWith('fc') || normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith('ff');
}

function isSafeSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return !(
      host === 'localhost' || host.endsWith('.localhost') || host === 'ip6-localhost' ||
      host === '0.0.0.0' || host.endsWith('.local') || host.endsWith('.internal')
    );
  } catch {
    return false;
  }
}

async function assertPublicSourceUrl(value) {
  if (!isSafeSourceUrl(value)) throw new Error('Only public HTTP(S) source URLs are supported.');
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private or local source addresses are not allowed.');
    return;
  }
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Source hostname could not be resolved.');
  }
  if (!records.length || records.some(record => isPrivateAddress(record.address))) {
    throw new Error('Source hostname resolves to a private or local address.');
  }
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractPageText(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Untitled source')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180);
  const text = decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, 7000);
  return { title: title || 'Untitled source', text };
}

async function fetchSource(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let currentUrl = url;
    let response;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      await assertPublicSourceUrl(currentUrl);
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'JARVIS-Source-Reader/1.0', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' }
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) throw new Error(`Source returned HTTP ${response.status} without a redirect target.`);
      currentUrl = new URL(location, currentUrl).toString();
      if (redirect === 3) throw new Error('Source redirected too many times.');
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/') && !contentType.includes('html') && !contentType.includes('json')) {
      throw new Error('Source is not readable text or HTML.');
    }
    const body = (await response.text()).slice(0, 800000);
    const parsed = contentType.includes('html') ? extractPageText(body) : { title: url, text: body.slice(0, 7000) };
    return { url, title: parsed.title, excerpt: parsed.text.slice(0, 420), text: parsed.text };
  } finally {
    clearTimeout(timeout);
  }
}

async function researchSources(input) {
  if (!apiBase || !apiKey) throw new Error('The managed AI service is not available to this server yet.');
  const urls = [...new Set((Array.isArray(input.urls) ? input.urls : []).map(value => String(value).trim()).filter(Boolean))].slice(0, 5);
  const question = String(input.question || 'What are the key details from these sources?').trim().slice(0, 500);
  if (!urls.length) throw new Error('Add at least one public source URL.');
  const settled = await Promise.allSettled(urls.map(fetchSource));
  const sources = settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : { url: urls[index], title: 'Source unavailable', excerpt: result.reason?.message || 'Could not read this source.', text: '' });
  const usable = sources.filter(source => source.text);
  if (!usable.length) throw new Error('None of the supplied sources could be read.');
  const sourcePack = usable.map((source, index) => `SOURCE [${index + 1}]\nTITLE: ${source.title}\nURL: ${source.url}\nTEXT: ${source.text}`).join('\n\n');
  const upstream = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are JARVIS Source Intelligence. Answer only from the supplied source excerpts. Be concise, note disagreement or missing information, and cite claims with [1], [2], etc. Never claim to have accessed a source that was unavailable.' },
        { role: 'user', content: `Research question: ${question}\n\n${sourcePack}` }
      ]
    })
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || payload.error) throw new Error(payload?.error?.message || `AI service returned HTTP ${upstream.status}.`);
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('The AI service returned no research answer.');
  return { question, answer: answer.trim(), sources: sources.map(({ url, title, excerpt, text }) => ({ url, title, excerpt, available: Boolean(text) })) };
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
    'Return exactly three options, one per line as OPTION 1:, OPTION 2:, OPTION 3:.',
    'After those lines, return one line beginning with EXPLANATION: explaining how the thread context shaped the options.',
    'Do not use markdown bullets or quotation marks around the options.'
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

  const parsed = cleanSuggestions(content);
  if (parsed.suggestions.length < 3) {
    throw new Error('The AI service returned fewer than three usable reply options.');
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
    if (url.pathname === '/api/research' && req.method === 'POST') {
      const input = await readJson(req);
      const result = await researchSources(input);
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
