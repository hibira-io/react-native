// An in-memory Beams device API behind a fetch function, enough for the
// HibiraPush client: register, token, interests, user, delete.
export function fakePushApi({ instanceId = 'inst-1' } = {}) {
  const devices = new Map();
  const log = [];
  let n = 0;
  const json = (status, body) =>
    new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (status, description) => json(status, { error: 'Error', description });

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    log.push([method, u.pathname, body, init.headers?.Authorization]);
    const m = u.pathname.match(/^\/device_api\/v1\/instances\/([^/]+)\/devices\/([^/]+)(?:\/([^/]+)(\/.*)?)?$/);
    if (!m) return fail(404, 'Not found');
    const [, inst, platform, id, rest = ''] = m;
    if (decodeURIComponent(inst) !== instanceId) return fail(404, 'Instance not found');
    if (!id) {
      if (method !== 'POST') return fail(405, 'Method');
      const dev = { id: `${platform}-${++n}`, platform, token: body.token, interests: new Set(), user: null, body };
      for (const prev of body.knownPreviousClientIds ?? []) {
        const p = devices.get(prev) ?? api.deleted.get(prev);
        if (p) dev.interests = new Set(p.interests);
      }
      devices.set(dev.id, dev);
      return json(200, { id: dev.id, initialInterestSet: [...dev.interests] });
    }
    const dev = devices.get(decodeURIComponent(id));
    if (!dev || dev.platform !== platform) return fail(404, 'Device not found');
    if (rest === '' && method === 'DELETE') {
      devices.delete(dev.id);
      api.deleted.set(dev.id, dev);
      return json(200);
    }
    if (rest === '/token' && method === 'PUT') {
      dev.token = body.token;
      return json(200);
    }
    if (rest === '/interests' && method === 'GET') return json(200, { interests: [...dev.interests] });
    if (rest === '/interests' && method === 'PUT') {
      dev.interests = new Set(body.interests);
      return json(200);
    }
    const im = rest.match(/^\/interests\/(.+)$/);
    if (im && method === 'POST') {
      dev.interests.add(decodeURIComponent(im[1]));
      return json(200);
    }
    if (im && method === 'DELETE') {
      dev.interests.delete(decodeURIComponent(im[1]));
      return json(200);
    }
    if (rest === '/user' && method === 'PUT') {
      const auth = init.headers?.Authorization ?? '';
      if (!auth.startsWith('Bearer ')) return fail(401, 'Missing Beams token');
      dev.user = auth.slice(7);
      return json(200);
    }
    return fail(404, 'Not found');
  }

  const api = { fetch, devices, deleted: new Map(), log };
  return api;
}

export function memoryStorage() {
  const items = new Map();
  return {
    items,
    getItem: async (k) => (items.has(k) ? items.get(k) : null),
    setItem: async (k, v) => void items.set(k, v),
    removeItem: async (k) => void items.delete(k),
  };
}
