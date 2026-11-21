import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('reply API health, validation, CORS, and mocked provider response', async () => {
  let capturedPrompt = '';
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    capturedPrompt = payload.messages?.[1]?.content || '';
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end(JSON.stringify({ choices:[{ message:{ content:JSON.stringify({ reply:'Test reply', explanation:'Mocked explanation' }) } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const apiPort = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd:process.cwd(),
    env:{ ...process.env, PORT:String(apiPort), MANUS_API_URL:'http://127.0.0.1:'+provider.address().port, MANUS_API_KEY:'test-key' },
    stdio:'ignore'
  });
  try {
    const baseUrl = 'http://127.0.0.1:'+apiPort;
    let health;
    for (let attempt=0; attempt<50; attempt++) {
      try { health = await fetch(baseUrl+'/api/health'); if (health.ok) break; }
      catch {}
      await new Promise(resolve => setTimeout(resolve,100));
    }
    assert.ok(health?.ok, 'server starts and health endpoint responds');
    assert.equal((await health.json()).aiConfigured, true);

    const origin = 'http://localhost:3000';
    const badMode = await fetch(baseUrl+'/api/reply', { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'}, body:JSON.stringify({message:'Hello',mode:'not-a-mode'}) });
    assert.equal(badMode.status,400);
    assert.equal(badMode.headers.get('access-control-allow-origin'),origin);

    const success = await fetch(baseUrl+'/api/reply', { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'}, body:JSON.stringify({
      message:'How are you?', mode:'Friendly',
      turns:[{from:'Friend',text:'Hope you are well.'},{from:'JARVIS',text:'fake draft',assistant:true,draft:true}],
      context:['greeting']
    }) });
    assert.equal(success.status,200);
    assert.deepEqual(await success.json(), {reply:'Test reply',explanation:'Mocked explanation',provider:'managed-llm'});
    assert.match(capturedPrompt,/Hope you are well/);
    assert.doesNotMatch(capturedPrompt,/fake draft/);

    const tooLong = await fetch(baseUrl+'/api/reply', { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'}, body:JSON.stringify({message:'x'.repeat(4001),mode:'JARVIS'}) });
    assert.equal(tooLong.status,400);
  } finally {
    child.kill();
    await new Promise(resolve => provider.close(resolve));
  }
});
