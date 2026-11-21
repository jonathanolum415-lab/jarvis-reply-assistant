import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

function createWorkerHarness(source, { initiallyOffline = false } = {}) {
  const listeners = new Map();
  const cacheStores = new Map();
  const openedCaches = [];
  const networkRequests = [];
  let offline = initiallyOffline;
  let skippedWaiting = false;
  let claimedClients = false;
  cacheStores.set('jarvis-shell-v6', new Map([
    ['https://jarvis.example/app.js', new Response('old app', { status: 200 })]
  ]));

  const cacheKey = request => typeof request === 'string'
    ? new URL(request, 'https://jarvis.example/sw.js').href
    : request.url;
  const caches = {
    async open(name) {
      openedCaches.push(name);
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const store = cacheStores.get(name);
      return {
        async addAll(requests) {
          for (const [index, request] of requests.entries()) {
            if (offline && index === 1) throw new Error('offline');
            const url = new URL(request, 'https://jarvis.example/sw.js');
            store.set(url.href, new Response('precached:' + url.href, { status: 200 }));
          }
        },
        async match(request) {
          return store.get(cacheKey(request)) || null;
        },
        async put(request, response) {
          store.set(cacheKey(request), response.clone());
        }
      };
    },
    async keys() {
      return [...cacheStores.keys()];
    },
    async delete(name) {
      return cacheStores.delete(name);
    }
  };
  const self = {
    location: { origin: 'https://jarvis.example' },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    skipWaiting() {
      skippedWaiting = true;
      return Promise.resolve();
    },
    clients: {
      claim() {
        claimedClients = true;
        return Promise.resolve();
      }
    }
  };
  const fetch = async (request, options = {}) => {
    networkRequests.push({ url: request.url, cache: options.cache });
    if (offline) throw new Error('offline');
    return new Response('fresh:' + request.url, { status: 200 });
  };

  runInNewContext(source, { self, caches, fetch, URL, Response, Promise });

  return {
    listeners,
    cacheStores,
    openedCaches,
    networkRequests,
    setOffline(value) {
      offline = value;
    },
    async lifecycle(name) {
      const event = {
        waitUntil(promise) {
          this.promise = promise;
        }
      };
      listeners.get(name)(event);
      return event.promise;
    },
    async requestAsset(path, destination) {
      const event = {
        request: {
          method: 'GET',
          url: 'https://jarvis.example/' + path,
          mode: 'cors',
          destination
        },
        respondWith(response) {
          this.response = response;
        }
      };
      listeners.get('fetch')(event);
      return event.response;
    },
    get skippedWaiting() {
      return skippedWaiting;
    },
    get claimedClients() {
      return claimedClients;
    }
  };
}

test('service worker precaches complete app shell before replacing old cache', async () => {
  const rootWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const publicWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.equal(publicWorker, rootWorker, 'GitHub Pages and the production build use the same service worker');

  const harness = createWorkerHarness(rootWorker);
  await harness.lifecycle('install');
  assert.equal(harness.skippedWaiting, true);
  const nextCache = harness.cacheStores.get('jarvis-shell-v7');
  for (const asset of ['./', './app.js', './keyboard.js', './styles.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']) {
    const url = new URL(asset, 'https://jarvis.example/sw.js').href;
    assert.ok(nextCache.has(url), asset + ' is pre-cached before activation');
  }

  await harness.lifecycle('activate');
  assert.equal(harness.cacheStores.has('jarvis-shell-v6'), false, 'old cache is removed after the new shell is ready');
  assert.equal(harness.claimedClients, true);

  for (const [path, destination] of [['app.js', 'script'], ['styles.css', 'style']]) {
    const response = await harness.requestAsset(path, destination);
    assert.equal(await response.text(), 'fresh:https://jarvis.example/' + path);
  }
  assert.deepEqual(harness.networkRequests.map(request => request.cache), ['no-cache', 'no-cache']);

  harness.setOffline(true);
  const fallback = await harness.requestAsset('app.js', 'script');
  assert.equal(await fallback.text(), 'fresh:https://jarvis.example/app.js');
});

test('failed offline pre-cache leaves the old app cache active', async () => {
  const rootWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const harness = createWorkerHarness(rootWorker, { initiallyOffline: true });

  await assert.rejects(harness.lifecycle('install'), /offline/);
  assert.equal(harness.skippedWaiting, false);
  assert.equal(harness.cacheStores.has('jarvis-shell-v7'), false, 'an incomplete cache revision is discarded');
  assert.equal(harness.cacheStores.has('jarvis-shell-v6'), true, 'the working offline cache is retained');
});
