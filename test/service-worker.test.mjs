import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('service worker refreshes app assets and falls back to cache offline', async () => {
  const rootWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const publicWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.equal(publicWorker, rootWorker, 'GitHub Pages and the production build use the same service worker');

  const listeners = new Map();
  const cacheStores = new Map();
  const openedCaches = [];
  const networkRequests = [];
  let offline = false;
  const caches = {
    async open(name) {
      openedCaches.push(name);
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const store = cacheStores.get(name);
      return {
        async match(request) {
          return store.get(request.url) || null;
        },
        async put(request, response) {
          store.set(request.url, response.clone());
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
      return Promise.resolve();
    },
    clients: {
      claim() {
        return Promise.resolve();
      }
    }
  };
  const fetch = async (request, options = {}) => {
    networkRequests.push({ url: request.url, cache: options.cache });
    if (offline) throw new Error('offline');
    return new Response('fresh:' + request.url, { status: 200 });
  };

  runInNewContext(rootWorker, { self, caches, fetch, URL, Response, Promise });

  async function requestAsset(path, destination) {
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
  }

  for (const [path, destination] of [['app.js', 'script'], ['styles.css', 'style']]) {
    const response = await requestAsset(path, destination);
    assert.equal(await response.text(), 'fresh:https://jarvis.example/' + path);
  }

  assert.deepEqual(networkRequests.map(request => request.cache), ['no-cache', 'no-cache']);
  assert.ok(openedCaches.includes('jarvis-shell-v7'), 'new cache revision replaces the stale app shell');

  offline = true;
  const fallback = await requestAsset('app.js', 'script');
  assert.equal(await fallback.text(), 'fresh:https://jarvis.example/app.js');
});
