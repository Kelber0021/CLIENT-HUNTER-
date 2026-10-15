// Nominatim proxy: one upstream request per second (usage policy), shared 24 h cache, identifying User-Agent.
import { USER_AGENT } from './osm-places.mjs'

const TTL_MS = 86_400_000
const MAX_ENTRIES = 500
const cache = new Map() // normalized query -> { value, expires }
const pending = new Map()
let queue = Promise.resolve()
let lastCall = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const buckets = new Map()
// Shared hosting IPs get rate limited by Nominatim; while blocked, answer 503 at once so the browser asks Nominatim itself.
let blockedUntil = 0

function json(res, status, body, cacheControl = 'no-store') {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl })
  res.end(JSON.stringify(body))
}

function limited(req) {
  const minute = Math.floor(Date.now() / 60_000)
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 64)
  const current = buckets.get(ip)
  const bucket = current?.minute === minute ? current : { minute, count: 0 }
  buckets.set(ip, bucket)
  if (buckets.size > 2000) for (const [key, value] of buckets) if (value.minute < minute - 1) buckets.delete(key)
  if (bucket.count >= 30) return true
  bucket.count++
  return false
}

// Serializes upstream calls and keeps at least 1 s between their starts.
function throttled(task) {
  const run = queue.then(async () => {
    const wait = lastCall + 1000 - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall = Date.now()
    return task()
  })
  queue = run.catch(() => {})
  return run
}

async function search(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ format: 'jsonv2', limit: '5', addressdetails: '1', q }).toString()
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('resposta inesperada')
  return data
    .map(place => ({ lat: Number(place.lat), lon: Number(place.lon), label: String(place.display_name || ''), type: String(place.addresstype || place.type || '') }))
    .filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon) && place.label)
    .slice(0, 5)
}

/** GET /api/geocode?q=<2..200 chars> → [{ lat, lon, label, type }] (max 5). */
export async function handleGeocode(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' })
  const q = (new URL(req.url || '/', 'http://localhost').searchParams.get('q') || '').trim().replace(/\s+/g, ' ')
  if (q.length < 2 || q.length > 200) return json(res, 400, { error: 'Digite de 2 a 200 caracteres para buscar um local.' })
  const key = q.normalize('NFC').toLocaleLowerCase('pt-BR')
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) {
    cache.delete(key); cache.set(key, hit)
    return json(res, 200, hit.value, 'public, max-age=3600')
  }
  if (limited(req)) return json(res, 429, { error: 'Muitas buscas de endereço em pouco tempo. Aguarde um minuto.' })
  if (Date.now() < blockedUntil) return json(res, 503, { error: 'Busca de endereço do servidor pausada. Tente pelo navegador.' })
  try {
    let promise = pending.get(key)
    if (!promise) {
      promise = throttled(() => search(q)).then(value => {
        cache.delete(key)
        cache.set(key, { value, expires: Date.now() + TTL_MS })
        while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
        return value
      }).finally(() => pending.delete(key))
      pending.set(key, promise)
    }
    json(res, 200, await promise, 'public, max-age=3600')
  } catch (error) {
    console.error('Nominatim failed:', error?.message || error)
    if (/HTTP (403|429)/.test(String(error?.message))) blockedUntil = Date.now() + 10 * 60_000
    json(res, 502, { error: 'Não foi possível buscar esse local agora. Tente novamente em instantes.' })
  }
}
