// Cloudflare Worker: paste this entire file into the Worker editor.
const SOURCE = 'https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json?page=0&size=2000';
const IDS = ['020016', '020206', '020058', '020072'];
const TTL = 60000;
const ORIGIN = 'https://leoshupinglin.github.io';
let pending;

export function normalize(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error('Invalid source response');
  const parks = Object.fromEntries(IDS.map(id => [id, null]));
  let found = false;
  for (const row of rows) {
    if (!IDS.includes(String(row.ID))) continue;
    found = true;
    const raw = row.AVAILABLECAR, value = Number(raw);
    parks[String(row.ID)] = raw != null && String(raw).trim() !== '' && Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (!found) throw new Error('Parking records missing');
  // The government endpoint supplies no per-record timestamp.
  // updatedAt records our successful retrieval, not a sensor update time.
  return { updatedAt: new Date(now).toISOString(), sourceUpdatedAt: null, parks };
}

function headers() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}

export function createHandler({ fetchSource = fetch, cache, now = Date.now } = {}) {
  return async function handle(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/parking') return new Response('Not found', { status: 404 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { ...headers(), Allow: 'GET, OPTIONS' } });
    const storage = cache || caches.default;
    const key = new Request(url.origin + '/parking');
    try {
      const hit = await storage.match(key);
      if (hit) {
        const payload = await hit.json();
        const age = now() - Date.parse(payload.updatedAt);
        if (age >= 0 && age < TTL) return Response.json(payload, { headers: headers() });
      }
      // Coalesce simultaneous misses in this Worker instance.
      if (!pending) {
        pending = (async () => {
          let lastError;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const upstream = await fetchSource(SOURCE, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(4500)
              });
              if (!upstream.ok) throw new Error('Source HTTP ' + upstream.status);
              const payload = normalize(await upstream.json(), now());
              const entry = Response.json(payload, { headers: { 'Cache-Control': 'public, max-age=60' } });
              ctx.waitUntil(storage.put(key, entry).catch(() => {}));
              return payload;
            } catch (error) { lastError = error; }
          }
          throw lastError;
        })().finally(() => { pending = undefined; });
      }
      return Response.json(await pending, { headers: headers() });
    } catch {
      // Never relabel old or failed data as freshly retrieved.
      return Response.json({ error: 'parking_unavailable', parks: null }, { status: 503, headers: headers() });
    }
  };
}

export default { fetch: createHandler() };
