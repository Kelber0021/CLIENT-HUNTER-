// Server-side OpenStreetMap search: global tile grid, shared cache (memory + Postgres),
// Overpass mirrors with cooldown/backoff and an NDJSON stream for the browser.
import zlib from 'node:zlib'

export const USER_AGENT = 'ClientHunter/0.3 (+https://github.com/Kelber0021/CLIENT-HUNTER-; Binary Labs)'

const GRID = 0.05
const FRESH_MS = 7 * 86_400_000
// Some mirrors lag months behind; their answers are kept only briefly so a current mirror gets another chance soon.
const OUTDATED_DATA_MS = 14 * 86_400_000
const OUTDATED_FRESH_MS = 12 * 3_600_000
const isFresh = (entry, now) => {
  const age = Date.parse(entry.dataTimestamp || '')
  const ttl = Number.isFinite(age) && now - age > OUTDATED_DATA_MS ? OUTDATED_FRESH_MS : FRESH_MS
  return now - entry.fetchedAt < ttl
}
const MEMORY_TILES = 600
const MEMORY_LEADS = 200_000 // keeps a few very dense tiles from exhausting a 512 MB instance
const MAX_TILES = 150
const MAX_OVERPASS = 2
const COOLDOWN_MS = 60_000
const CHUNK_BUDGET_MS = 4 * 60_000
const REQUEST_BUDGET_MS = 6 * 60_000
const FETCH_TIMEOUT_MS = 150_000
const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// ---------- Taxonomy ----------
export const CATEGORIES = {
  restaurant: 'Restaurantes e bares',
  cafe: 'Cafés e padarias',
  beauty: 'Beleza e estética',
  health: 'Saúde e clínicas',
  fitness: 'Academias e esporte',
  hotel: 'Hotéis e hospedagem',
  auto: 'Automotivo',
  education: 'Cursos e escolas livres',
  office: 'Escritórios e serviços',
  shop: 'Lojas e varejo',
}
const set = list => new Set(list.split(' '))
const RESTAURANT = set('restaurant bar pub fast_food food_court ice_cream biergarten nightclub')
const CAFE_SHOP = set('bakery pastry confectionery coffee tea chocolate')
const BEAUTY_SHOP = set('beauty hairdresser cosmetics nails tattoo massage perfumery hairdresser_supply')
const HEALTH_AMENITY = set('clinic dentist doctors pharmacy hospital veterinary')
const HEALTH_SHOP = set('optician medical_supply hearing_aids chemist')
const FITNESS_LEISURE = set('fitness_centre sports_centre sports_hall dance')
const HOTEL = set('hotel motel guest_house hostel apartment chalet')
const AUTO_AMENITY = set('fuel car_wash car_rental')
const AUTO_SHOP = set('car car_repair car_parts tyres motorcycle motorcycle_repair')
const EDUCATION = set('driving_school language_school music_school training prep_school')
const OFFICE_AMENITY = set('bank coworking_space bureau_de_change money_transfer')
const OFFICE_EXCLUDED = set('government diplomatic')
// "no" means the feature is explicitly NOT that kind of place; vacant shops are not businesses.
const has = (tags, key) => typeof tags[key] === 'string' && tags[key] !== '' && tags[key] !== 'no'

/** Returns the category key for OSM tags (first match wins) or null. */
export function classify(tags) {
  if (!tags) return null
  const { amenity, shop, leisure, tourism, office } = tags
  if (RESTAURANT.has(amenity)) return 'restaurant'
  if (amenity === 'cafe' || CAFE_SHOP.has(shop)) return 'cafe'
  if (BEAUTY_SHOP.has(shop)) return 'beauty'
  if (HEALTH_AMENITY.has(amenity) || has(tags, 'healthcare') || HEALTH_SHOP.has(shop)) return 'health'
  if (FITNESS_LEISURE.has(leisure) || amenity === 'dojo' || shop === 'sports') return 'fitness'
  if (HOTEL.has(tourism)) return 'hotel'
  if (AUTO_AMENITY.has(amenity) || AUTO_SHOP.has(shop)) return 'auto'
  if (EDUCATION.has(amenity)) return 'education'
  if ((has(tags, 'office') && !OFFICE_EXCLUDED.has(office)) || has(tags, 'craft') || OFFICE_AMENITY.has(amenity)) return 'office'
  if (has(tags, 'shop') && shop !== 'vacant') return 'shop'
  return null
}

const TAG_WHITELIST = ['name', 'brand', 'operator', 'addr:street', 'addr:housenumber', 'addr:suburb', 'addr:city', 'addr:postcode', 'addr:full', 'phone', 'contact:phone', 'mobile', 'contact:mobile', 'whatsapp', 'contact:whatsapp', 'email', 'contact:email', 'website', 'contact:website', 'contact:instagram', 'contact:facebook', 'opening_hours', 'image', 'contact:image', 'wikimedia_commons', 'cuisine', 'amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure', 'description']
const first = (tags, ...keys) => { for (const key of keys) if (typeof tags[key] === 'string' && tags[key].trim()) return tags[key].trim().slice(0, 300) }
const round7 = n => Math.round(n * 1e7) / 1e7

/** Converts an Overpass/OSM element into the compact Lead object, or null when it is not a business. */
export function buildLead(element) {
  const t = element?.tags
  if (!t || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(Number(element.id))) return null
  const name = typeof t.name === 'string' ? t.name.trim() : ''
  const categoryKey = name ? classify(t) : null
  if (!categoryKey) return null
  const point = element.type === 'node' ? element : element.center
  const lat = Number(point?.lat), lon = Number(point?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const tags = {}
  for (const key of TAG_WHITELIST) if (typeof t[key] === 'string' && t[key]) tags[key] = t[key].slice(0, 300)
  const id = `${element.type}/${Number(element.id)}`
  const lead = {
    id,
    name: name.slice(0, 200),
    category: CATEGORIES[categoryKey],
    categoryKey,
    address: ([t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || t['addr:full'] || 'Endereço não informado').slice(0, 300),
    city: (t['addr:city'] || t['addr:suburb'] || '').slice(0, 300),
    lat: round7(lat),
    lon: round7(lon),
    phone: first(t, 'phone', 'contact:phone', 'mobile', 'contact:mobile'),
    website: first(t, 'website', 'contact:website'),
    email: first(t, 'email', 'contact:email'),
    instagram: first(t, 'contact:instagram', 'instagram'),
    whatsapp: first(t, 'contact:whatsapp', 'whatsapp'),
    facebook: first(t, 'contact:facebook', 'facebook'),
    openingHours: first(t, 'opening_hours'),
    osmUrl: `https://www.openstreetmap.org/${id}`,
    source: 'OpenStreetMap',
    tags,
  }
  for (const key of Object.keys(lead)) if (lead[key] === undefined) delete lead[key]
  return lead
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const h = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ---------- Tile grid ----------
const tileKey = (ix, iy) => `v1:${ix}:${iy}`
const tileOf = (lat, lon) => [Math.floor(lon / GRID), Math.floor(lat / GRID)]
const edge = n => Number((n * GRID).toFixed(4))
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const rectBox = r => ({ south: clamp(edge(r.y0), -90, 90), west: clamp(edge(r.x0), -180, 180), north: clamp(edge(r.y1 + 1), -90, 90), east: clamp(edge(r.x1 + 1), -180, 180) })
function rectKeys(r) { const keys = []; for (let iy = r.y0; iy <= r.y1; iy++) for (let ix = r.x0; ix <= r.x1; ix++) keys.push(tileKey(ix, iy)); return keys }
const inRect = (r, ix, iy) => ix >= r.x0 && ix <= r.x1 && iy >= r.y0 && iy <= r.y1

function searchTiles(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32
  const dLon = radiusKm / (111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.01))
  const [x0, y0] = tileOf(lat - dLat, lon - dLon), [x1, y1] = tileOf(lat + dLat, lon + dLon)
  const tiles = []
  for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
    const b = rectBox({ x0: ix, x1: ix, y0: iy, y1: iy })
    const distance = distanceKm(lat, lon, clamp(lat, b.south, b.north), clamp(lon, b.west, b.east))
    if (distance <= radiusKm) tiles.push({ ix, iy, key: tileKey(ix, iy), distance })
  }
  return tiles.sort((a, b) => a.distance - b.distance)
}

// Group tiles into rectangles of at most 4x4 using globally aligned blocks, so overlapping searches build the same chunks.
function chunkTiles(tiles) {
  const blocks = new Map()
  for (const t of tiles) {
    const id = `${Math.floor(t.ix / 4)}:${Math.floor(t.iy / 4)}`
    const r = blocks.get(id)
    if (!r) blocks.set(id, { x0: t.ix, x1: t.ix, y0: t.iy, y1: t.iy, distance: t.distance })
    else Object.assign(r, { x0: Math.min(r.x0, t.ix), x1: Math.max(r.x1, t.ix), y0: Math.min(r.y0, t.iy), y1: Math.max(r.y1, t.iy), distance: Math.min(r.distance, t.distance) })
  }
  return [...blocks.values()].sort((a, b) => a.distance - b.distance)
}

function splitRect(r) {
  const halves = (a, b) => b > a ? [[a, a + Math.ceil((b - a + 1) / 2) - 1], [a + Math.ceil((b - a + 1) / 2), b]] : [[a, b]]
  return halves(r.x0, r.x1).flatMap(([x0, x1]) => halves(r.y0, r.y1).map(([y0, y1]) => ({ x0, x1, y0, y1 })))
}

// ---------- Cache ----------
const memory = new Map() // tileKey -> { leads, dataTimestamp, fetchedAt }
let memoryLeads = 0
let dbReady = false
const stats = { cacheHits: 0, cacheMisses: 0, overpassRequests: 0, overpassFailures: 0, sampleFallbacks: 0 }

function memoryGet(key) {
  const entry = memory.get(key)
  if (entry) { memory.delete(key); memory.set(key, entry) }
  return entry
}
function memorySet(key, entry) {
  const previous = memory.get(key)
  if (previous) { memoryLeads -= previous.leads.length; memory.delete(key) }
  memory.set(key, entry)
  memoryLeads += entry.leads.length
  while (memory.size > 1 && (memory.size > MEMORY_TILES || memoryLeads > MEMORY_LEADS)) {
    const [oldest, value] = memory.entries().next().value
    memory.delete(oldest)
    memoryLeads -= value.leads.length
  }
}

const withTimeout = (promise, ms) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })]).finally(() => clearTimeout(timer)) }

/** Creates the shared tile cache table (call inside the startup transaction) and drops rows older than 30 days. */
export async function ensureCacheTable(client) {
  await client.query(`create table if not exists osm_tile_cache (
    tile_key text primary key,
    leads jsonb not null,
    data_timestamp text,
    fetched_at timestamptz not null default now()
  )`)
  await client.query(`delete from osm_tile_cache where fetched_at < now() - interval '30 days'`)
  dbReady = true
}

async function lookup(keys, pool) {
  const found = new Map()
  const missing = []
  for (const key of keys) { const entry = memoryGet(key); if (entry) found.set(key, entry); else missing.push(key) }
  if (missing.length && pool && dbReady) {
    try {
      const result = await withTimeout(pool.query(`select tile_key, leads, data_timestamp, (extract(epoch from fetched_at) * 1000)::float8 as fetched_at
        from osm_tile_cache where tile_key = any($1::text[]) and fetched_at > now() - interval '30 days'`, [missing]), 4000)
      for (const row of result.rows) {
        const entry = { leads: Array.isArray(row.leads) ? row.leads : [], dataTimestamp: row.data_timestamp || null, fetchedAt: Number(row.fetched_at) }
        memorySet(row.tile_key, entry)
        found.set(row.tile_key, entry)
      }
    } catch (error) { console.error('osm_tile_cache read failed:', error.message) }
  }
  return found
}

function persist(pool, rows) {
  if (!pool || !dbReady || !rows.length) return
  pool.query(`insert into osm_tile_cache (tile_key, leads, data_timestamp, fetched_at)
    select x.key, x.leads, x.ts, now() from jsonb_to_recordset($1::jsonb) as x(key text, leads jsonb, ts text)
    on conflict (tile_key) do update set leads = excluded.leads, data_timestamp = excluded.data_timestamp, fetched_at = excluded.fetched_at`, [JSON.stringify(rows)])
    .catch(error => console.error('osm_tile_cache write failed:', error.message))
}

// ---------- Overpass (global semaphore, mirrors, cooldown, backoff) ----------
let active = 0
const waiting = []
const acquire = () => active < MAX_OVERPASS ? (active++, Promise.resolve()) : new Promise(resolve => waiting.push(resolve))
const release = () => { const next = waiting.shift(); if (next) next(); else active-- }
const cooldown = new Map()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const BUSY = /at capacity|too busy|rate_limited|Dispatcher_Client|too many requests|try again later/i
let endpointCache
function endpoints() {
  if (!endpointCache) {
    const custom = (process.env.OVERPASS_URLS || '').split(',').map(s => s.trim()).filter(s => /^https?:\/\//.test(s))
    endpointCache = custom.length ? custom : DEFAULT_ENDPOINTS
  }
  return endpointCache
}
const host = url => { try { return new URL(url).host } catch { return url } }
const failure = (code, message) => Object.assign(new Error(message || code), { code })

function overpassQuery({ south, west, north, east }) {
  const b = `${south},${west},${north},${east}`
  return `[out:json][timeout:120];(`
    + `nwr["amenity"~"^(restaurant|bar|pub|fast_food|food_court|ice_cream|biergarten|nightclub|cafe|clinic|dentist|doctors|pharmacy|hospital|veterinary|dojo|fuel|car_wash|car_rental|driving_school|language_school|music_school|training|prep_school|bank|coworking_space|bureau_de_change|money_transfer)$"]["name"](${b});`
    + `nwr["shop"]["name"](${b});nwr["healthcare"]["name"](${b});nwr["craft"]["name"](${b});nwr["office"]["name"](${b});`
    + `nwr["leisure"~"^(fitness_centre|sports_centre|sports_hall|dance)$"]["name"](${b});`
    + `nwr["tourism"~"^(hotel|motel|guest_house|hostel|apartment|chalet)$"]["name"](${b});`
    + `);out center qt;`
}

// One HTTP attempt. Returns { data } | { timeout: reason } | { fail: reason }.
async function overpassOnce(url, query, timeoutMs) {
  const started = Date.now()
  stats.overpassRequests++
  try {
    const response = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    const text = await response.text()
    if (response.status === 504 && !BUSY.test(text)) return { timeout: 'HTTP 504' }
    if (!response.ok) return { fail: `HTTP ${response.status}${BUSY.test(text) ? ' (ocupado)' : ''}` }
    if (!text.trimStart().startsWith('{')) return { fail: 'resposta não JSON' }
    let data
    try { data = JSON.parse(text) } catch { return { fail: 'JSON inválido' } }
    if (!Array.isArray(data?.elements)) return { fail: 'sem elements' }
    const remark = typeof data.remark === 'string' ? data.remark : ''
    // Overpass answers 200 with a "runtime error" remark and partial/empty elements: never a complete result.
    if (/runtime error/i.test(remark)) return BUSY.test(remark) ? { fail: remark.slice(0, 160) } : { timeout: remark.slice(0, 160) }
    console.log(`Overpass ${host(url)} ok: ${data.elements.length} elementos em ${Date.now() - started} ms`)
    return { data }
  } catch (error) {
    return { fail: error?.name === 'TimeoutError' ? 'tempo esgotado' : `rede: ${error?.cause?.code || error?.message || 'erro'}` }
  }
}

function notify(shared, message) { for (const listener of shared.listeners) listener(message) }

async function queryOverpass(rect, shared, deadline) {
  const query = overpassQuery(rectBox(rect))
  let tried = new Set(), backoff = 0, probe = false
  for (;;) {
    if (shared.refs <= 0) throw failure('abandoned')
    if (Date.now() >= deadline) throw failure('busy', 'prazo do bloco esgotado')
    const list = endpoints()
    const now = Date.now()
    let url = list.find(u => !tried.has(u) && !((cooldown.get(u) || 0) > now))
    // After a backoff pause, probe the endpoint whose cooldown ends first instead of waiting a full minute.
    if (!url && probe) url = [...list].sort((a, b) => (cooldown.get(a) || 0) - (cooldown.get(b) || 0))[0]
    if (!url) {
      const wait = Math.min(2 ** ++backoff, 16)
      if (Date.now() + wait * 1000 >= deadline) throw failure('busy', 'servidores ocupados')
      notify(shared, `Servidor do OpenStreetMap ocupado. Nova tentativa em ${wait} s…`)
      await sleep(wait * 1000)
      tried = new Set(); probe = true
      continue
    }
    probe = false
    tried.add(url)
    await acquire()
    let result
    try {
      if (shared.refs <= 0) throw failure('abandoned')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw failure('busy', 'prazo do bloco esgotado')
      result = await overpassOnce(url, query, Math.min(FETCH_TIMEOUT_MS, Math.max(30_000, remaining)))
    } finally { release() }
    if (result.data) return result.data
    stats.overpassFailures++
    const box = rectBox(rect)
    console.warn(`Overpass ${host(url)} falhou (${result.timeout || result.fail}) bbox=${box.south},${box.west},${box.north},${box.east}`)
    if (result.timeout) throw failure('timeout', result.timeout)
    cooldown.set(url, Date.now() + COOLDOWN_MS)
    if (list.some(u => !tried.has(u) && !((cooldown.get(u) || 0) > Date.now()))) notify(shared, 'Trocando para outro servidor de dados…')
  }
}

// ---------- In-flight jobs ----------
const inflight = new Map() // tileKey -> { promise, shared }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function attach(shared, ctx) { if (ctx.shared.has(shared)) return; shared.refs++; shared.listeners.add(ctx.notify); ctx.shared.add(shared) }
function detach(ctx) { for (const shared of ctx.shared) { shared.refs--; shared.listeners.delete(ctx.notify) } ctx.shared.clear() }

function settle(job, key, entry) {
  const d = job.deferreds.get(key)
  if (!d) return
  job.deferreds.delete(key)
  if (inflight.get(key)?.promise === d.promise) inflight.delete(key)
  d.resolve(entry)
}

function store(job, rect, data) {
  const dataTimestamp = data.osm3s?.timestamp_osm_base || null
  const byTile = new Map(rectKeys(rect).map(key => [key, []]))
  for (const element of data.elements) {
    const lead = buildLead(element)
    if (!lead) continue
    const [ix, iy] = tileOf(lead.lat, lead.lon)
    if (inRect(rect, ix, iy)) byTile.get(tileKey(ix, iy)).push(lead)
  }
  const fetchedAt = Date.now()
  const rows = []
  for (const [key, leads] of byTile) {
    const entry = { leads, dataTimestamp, fetchedAt }
    memorySet(key, entry)
    rows.push({ key, leads, ts: dataTimestamp })
    settle(job, key, entry)
  }
  persist(job.pool, rows)
}

async function runRect(job, rect) {
  let error
  try { store(job, rect, await queryOverpass(rect, job.shared, job.deadline)); return } catch (e) { error = e }
  if (error?.code === 'timeout' && (rect.x1 > rect.x0 || rect.y1 > rect.y0)) {
    notify(job.shared, 'Área grande: dividindo a consulta em partes…')
    await Promise.all(splitRect(rect).map(sub => runRect(job, sub)))
    return
  }
  if (error?.code !== 'abandoned' && error?.code !== 'timeout' && error?.code !== 'busy') console.error('Overpass chunk error:', error)
  for (const key of rectKeys(rect)) settle(job, key, null)
}

// Returns [tile, Promise<entry|null>] for every tile, joining in-flight fetches from other visitors.
function obtain(tiles, ctx, pool) {
  const pending = []
  const fresh = []
  for (const t of tiles) {
    const current = inflight.get(t.key)
    if (current) { attach(current.shared, ctx); pending.push([t, current.promise]) } else fresh.push(t)
  }
  for (const rect of chunkTiles(fresh)) {
    const shared = { refs: 0, listeners: new Set() }
    attach(shared, ctx)
    const job = { shared, pool, deadline: Date.now() + CHUNK_BUDGET_MS, deferreds: new Map() }
    for (const key of rectKeys(rect)) {
      if (inflight.has(key)) continue
      const d = deferred()
      job.deferreds.set(key, d)
      inflight.set(key, { promise: d.promise, shared })
    }
    for (const t of fresh) if (inRect(rect, t.ix, t.iy)) pending.push([t, job.deferreds.get(t.key).promise])
    runRect(job, rect)
      .catch(error => console.error('Overpass job error:', error))
      .finally(() => { for (const key of [...job.deferreds.keys()]) settle(job, key, null) })
  }
  return pending
}

// ---------- HTTP ----------
const buckets = new Map()
function limited(req) {
  const minute = Math.floor(Date.now() / 60_000)
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 64)
  const current = buckets.get(ip)
  const bucket = current?.minute === minute ? current : { minute, count: 0 }
  buckets.set(ip, bucket)
  if (buckets.size > 2000) for (const [key, value] of buckets) if (value.minute < minute - 1) buckets.delete(key)
  if (bucket.count >= 12) return true
  bucket.count++
  return false
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function cacheStats() {
  const now = Date.now()
  return {
    memoryTiles: memory.size,
    memoryLeads,
    database: dbReady,
    inflightTiles: inflight.size,
    overpassActive: active,
    overpassQueued: waiting.length,
    coolingDown: endpoints().filter(u => (cooldown.get(u) || 0) > now).map(host),
    ...stats,
  }
}

/** GET /api/places?lat&lon&radius(km 1..15)&category → NDJSON stream (start, leads*, status*, done|error). */
export async function handlePlaces(req, res, { pool = null } = {}) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' })
  const params = new URL(req.url || '/', 'http://localhost').searchParams
  const lat = Number(params.get('lat')), lon = Number(params.get('lon')), radiusKm = Number(params.get('radius'))
  const category = params.get('category') || 'all'
  if (!params.get('lat') || !params.get('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 15) {
    return json(res, 400, { error: 'Informe latitude, longitude e um raio inteiro de 1 a 15 km.' })
  }
  if (category !== 'all' && !Object.hasOwn(CATEGORIES, category)) return json(res, 400, { error: 'Segmento inválido.' })
  const tiles = searchTiles(lat, lon, radiusKm)
  if (!tiles.length || tiles.length > MAX_TILES) return json(res, 400, { error: 'Área de busca inválida para esta latitude.' })
  if (limited(req)) return json(res, 429, { error: 'Muitas buscas em pouco tempo. Aguarde um minuto e tente novamente.' })

  const started = Date.now()
  const gzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || '')) ? zlib.createGzip() : null
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) })
  res.on('error', () => {})
  if (gzip) { gzip.on('error', () => res.destroy()); gzip.pipe(res) }
  const out = gzip || res
  const abort = new AbortController()
  let closed = false
  res.on('close', () => { closed = true; abort.abort() })
  let lastSent = Date.now(), lastStatus = '', lastStatusAt = 0
  const send = event => {
    if (closed || out.writableEnded) return
    lastSent = Date.now()
    out.write(JSON.stringify(event) + '\n')
    if (gzip) gzip.flush(zlib.constants.Z_SYNC_FLUSH)
  }
  const status = message => {
    if (message === lastStatus && Date.now() - lastStatusAt < 3000) return
    lastStatus = message; lastStatusAt = Date.now()
    send({ type: 'status', message })
  }
  const ctx = { notify: status, shared: new Set() }
  const heartbeat = setInterval(() => { if (Date.now() - lastSent >= 15_000) status(`Ainda consultando o OpenStreetMap… ${Math.round((Date.now() - started) / 1000)} s`) }, 5000)
  let budgetTimer
  const finish = () => { clearInterval(heartbeat); clearTimeout(budgetTimer); detach(ctx); if (!out.writableEnded) out.end() }

  const sentIds = new Set()
  let count = 0, tilesDone = 0, dataTimestamp = null
  try {
    const emit = (entries, from) => {
      const leads = []
      for (const entry of entries) {
        for (const lead of entry.leads) {
          if ((category !== 'all' && lead.categoryKey !== category) || sentIds.has(lead.id) || distanceKm(lat, lon, lead.lat, lead.lon) > radiusKm) continue
          sentIds.add(lead.id)
          leads.push(lead)
        }
        if (entry.dataTimestamp && (!dataTimestamp || entry.dataTimestamp < dataTimestamp)) dataTimestamp = entry.dataTimestamp
      }
      tilesDone += entries.length
      count += leads.length
      send({ type: 'leads', leads, tilesDone, tiles: tiles.length, from })
    }

    const found = await lookup(tiles.map(t => t.key), pool)
    const fresh = [], stale = new Map(), missing = []
    for (const t of tiles) {
      const entry = found.get(t.key)
      if (entry && isFresh(entry, started)) fresh.push(entry)
      else { if (entry) stale.set(t.key, entry); missing.push(t) }
    }
    stats.cacheHits += fresh.length
    stats.cacheMisses += missing.length
    send({ type: 'start', tiles: tiles.length, cached: fresh.length, radiusKm, category })
    // Cached tiles first, nearest first, in batches so huge areas still render progressively.
    let batch = [], batchSize = 0
    for (const entry of fresh) {
      batch.push(entry); batchSize += entry.leads.length
      if (batchSize >= 1500) { emit(batch, 'cache'); batch = []; batchSize = 0 }
    }
    if (batch.length) emit(batch, 'cache')

    if (missing.length && !closed) {
      status('Consultando o OpenStreetMap…')
      let buffer = [], scheduled = false
      const flush = () => { scheduled = false; if (buffer.length) { const loaded = buffer; buffer = []; emit(loaded, 'overpass') } }
      const all = Promise.all(obtain(missing, ctx, pool).map(([tile, promise]) => promise.then(entry => {
        if (entry) { buffer.push(entry); if (!scheduled) { scheduled = true; setImmediate(flush) } }
        else if (stale.has(tile.key)) emit([stale.get(tile.key)], 'cache') // older copy beats nothing
      })))
      const budget = new Promise(resolve => { budgetTimer = setTimeout(resolve, Math.max(0, REQUEST_BUDGET_MS - (Date.now() - started))) })
      const aborted = new Promise(resolve => abort.signal.addEventListener('abort', resolve, { once: true }))
      await Promise.race([all, budget, aborted])
      flush()
    }
    if (closed) return

    let sampled = false
    if (!tilesDone) {
      status('Fonte principal indisponível. Mostrando uma amostra parcial…')
      stats.sampleFallbacks++
      try {
        const { osmSample } = await import('./osm-sample.mjs')
        const data = await osmSample(lat, lon, category, radiusKm)
        const leads = data.elements.map(buildLead).filter(lead => lead && (category === 'all' || lead.categoryKey === category) && !sentIds.has(lead.id) && distanceKm(lat, lon, lead.lat, lead.lon) <= radiusKm)
        for (const lead of leads) sentIds.add(lead.id)
        count += leads.length
        sampled = true
        send({ type: 'leads', leads, tilesDone, tiles: tiles.length, from: 'sample' })
      } catch (error) {
        console.error('OSM sample fallback failed:', error?.message || error)
        send({ type: 'error', message: 'Não foi possível carregar os estabelecimentos agora. Tente novamente em alguns minutos.' })
        return
      }
    }
    send({ type: 'done', count, tilesDone, tiles: tiles.length, complete: !sampled && tilesDone === tiles.length, sampled, elapsedMs: Date.now() - started, dataTimestamp })
  } catch (error) {
    console.error('Places search failed:', error)
    if (count || tilesDone) send({ type: 'done', count, tilesDone, tiles: tiles.length, complete: false, sampled: false, elapsedMs: Date.now() - started, dataTimestamp })
    else send({ type: 'error', message: 'Erro interno na busca. Tente novamente.' })
  } finally { finish() }
}
