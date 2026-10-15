import { createServer } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import pg from 'pg'
import { handleSample } from './osm-sample.mjs'
import { handleGooglePlaces, googlePlacesStatus } from './google-places.mjs'
import { handlePlaces, ensureCacheTable, cacheStats } from './osm-places.mjs'
import { handleGeocode } from './geocode.mjs'

const dist = resolve('dist')
const indexFile = resolve(dist, 'index.html')
const port = Number(process.env.PORT || 4173)
// Local-only sessions can use an ephemeral key; persistent deployments must set SESSION_SECRET.
const sessionSecret = process.env.SESSION_SECRET || (!process.env.DATABASE_URL ? randomUUID() : null)
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10_000 }) : null
// An idle client error (e.g. database restart) must not crash the process.
pool?.on('error', error => console.error('Postgres pool error:', error.message))
const stages = new Set(['novo', 'qualificado', 'contatado', 'negociando', 'ganho'])
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 // seconds; sliding, renewed on every session use
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}
const compressible = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt'])
const gzipCache = new Map() // `${path}:${mtimeMs}` -> Buffer
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
}

if (pool) {
  if (!sessionSecret) throw new Error('SESSION_SECRET is required when DATABASE_URL is configured')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`create table if not exists saved_leads (
      profile_id uuid not null,
      id text not null,
      lead jsonb not null,
      stage text not null default 'novo' check (stage in ('novo','qualificado','contatado','negociando','ganho')),
      note text not null default '',
      saved_at timestamptz not null default now(),
      primary key (profile_id, id)
    )`)
    const columns = await client.query(`select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'saved_leads'`)
    if (!columns.rows.some(row => row.column_name === 'profile_id')) {
      // Preserve existing shared leads under an inaccessible legacy profile; never expose them to a new visitor.
      await client.query('alter table saved_leads add column profile_id uuid')
      await client.query('update saved_leads set profile_id = $1', [randomUUID()])
      await client.query('alter table saved_leads alter column profile_id set not null')
      const pk = await client.query(`select conname from pg_constraint where conrelid = 'saved_leads'::regclass and contype = 'p'`)
      if (pk.rows[0]) await client.query(`alter table saved_leads drop constraint "${pk.rows[0].conname.replaceAll('"', '""')}"`)
      await client.query('alter table saved_leads add primary key (profile_id, id)')
    }
    await client.query('create index if not exists saved_leads_profile_saved_at on saved_leads (profile_id, saved_at desc)')
    // The tile cache is optional: a failure here must not block the saved-leads migration.
    await client.query('savepoint osm_tile_cache')
    try { await ensureCacheTable(client); await client.query('release savepoint osm_tile_cache') }
    catch (error) { console.error('OSM tile cache disabled:', error.message); await client.query('rollback to savepoint osm_tile_cache') }
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
async function body(req) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 262144) throw new HttpError(413, 'Conteúdo grande demais.') }
  let value
  try { value = JSON.parse(raw || '{}') } catch { throw new HttpError(400, 'JSON inválido.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'JSON inválido.')
  return value
}
function signature(payload) { return createHmac('sha256', sessionSecret).update(payload).digest('hex') }
function profile(req) {
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)ch_session=([^;]+)/)?.[1]
  if (!cookie) return null
  const [id, expires, sig, extra] = cookie.split('.')
  if (extra || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '') || !/^\d{13}$/.test(expires || '') || !/^[0-9a-f]{64}$/.test(sig || '') || Number(expires) < Date.now()) return null
  const expected = signature(`${id}.${expires}`)
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null
}
function setCookie(res, id, req) {
  const expires = String(Date.now() + COOKIE_MAX_AGE * 1000)
  const value = `${id}.${expires}.${signature(`${id}.${expires}`)}`
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `ch_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`)
}
function session(req, res) {
  if (!sessionSecret) { json(res, 503, { error: 'Sessão não configurada.' }); return null }
  let id = profile(req)
  if (!id) id = randomUUID()
  setCookie(res, id, req)
  return id
}

// Rebuilds a saved lead from whitelisted fields only; returns null when the input is invalid.
const leadStrings = ['category', 'categoryKey', 'address', 'city', 'phone', 'website', 'email', 'instagram', 'whatsapp', 'facebook', 'openingHours', 'source']
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
function sanitizeLead(input) {
  if (!isPlainObject(input)) return null
  if (typeof input.id !== 'string' || !/^(node|way|relation)\/\d{1,15}$/.test(input.id)) return null
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) return null
  const lat = input.lat, lon = input.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const osmUrl = input.osmUrl ?? `https://www.openstreetmap.org/${input.id}`
  if (typeof osmUrl !== 'string' || !osmUrl.startsWith('https://www.openstreetmap.org/')) return null
  const lead = { id: input.id, name: input.name.trim(), lat, lon, osmUrl: osmUrl.slice(0, 500) }
  for (const key of leadStrings) {
    const value = input[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') return null
    lead[key] = value.slice(0, 500)
  }
  if (input.tags !== undefined && input.tags !== null) {
    if (!isPlainObject(input.tags)) return null
    const tags = {}
    let kept = 0
    for (const [key, value] of Object.entries(input.tags)) {
      if (kept >= 40) break
      if (typeof value !== 'string' || !key || key.length > 100 || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      tags[key] = value.slice(0, 300)
      kept++
    }
    lead.tags = tags
  } else lead.tags = {}
  return lead
}

const statSafe = file => { try { return statSync(file) } catch { return null } }
function serveStatic(req, res, url) {
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { pathname = '/' }
  const requested = resolve(dist, `.${pathname}`)
  const inside = requested === dist || requested.startsWith(dist + sep)
  let file = indexFile
  let stat
  if (extname(requested)) {
    stat = inside ? statSafe(requested) : null
    if (!stat?.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Arquivo não encontrado.'); return }
    file = requested
  } else stat = statSafe(indexFile)
  if (!stat?.isFile()) { json(res, 503, { error: 'Execute npm run build antes de iniciar o servidor.' }); return }
  const ext = extname(file)
  const headers = {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': file === indexFile ? 'no-cache' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  }
  if (compressible.has(ext)) {
    headers.Vary = 'Accept-Encoding'
    if (/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) {
      const key = `${file}:${stat.mtimeMs}`
      let gz = gzipCache.get(key)
      if (!gz) {
        gz = gzipSync(readFileSync(file))
        gzipCache.set(key, gz)
        if (gzipCache.size > 200) gzipCache.delete(gzipCache.keys().next().value)
      }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length })
      res.end(req.method === 'HEAD' ? undefined : gz)
      return
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

const server = createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value)
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/api/health') { json(res, 200, { ok: true, database: !!pool, cache: cacheStats() }); return }
    if (url.pathname === '/api/places') { await handlePlaces(req, res, { pool }); return }
    if (url.pathname === '/api/geocode') { await handleGeocode(req, res); return }
    if (url.pathname === '/api/osm-sample' && req.method === 'GET') { await handleSample(req, res); return }
    if (url.pathname === '/api/google-places/status') { googlePlacesStatus(req, res); return }
    if (url.pathname === '/api/google-places') { await handleGooglePlaces(req, res); return }
    if (url.pathname === '/api/session') {
      if (req.method === 'GET' || req.method === 'POST') { if (session(req, res)) json(res, 200, { databaseConfigured: !!pool, authenticated: true }); return }
      if (req.method === 'DELETE') { if (sessionSecret) { const id = randomUUID(); setCookie(res, id, req); json(res, 200, { databaseConfigured: !!pool, authenticated: true }) } else json(res, 503, { error: 'Sessão não configurada.' }); return }
      json(res, 405, { error: 'Método não permitido.' }); return
    }
    if (url.pathname === '/api/leads') {
      if (!pool) { json(res, 503, { error: 'Banco não configurado.' }); return }
      const profileId = session(req, res)
      if (!profileId) return
      if (req.method === 'GET') {
        const rows = await pool.query('select lead, stage, note, extract(epoch from saved_at) * 1000 as "savedAt" from saved_leads where profile_id=$1 order by saved_at desc', [profileId])
        json(res, 200, rows.rows); return
      }
      if (req.method === 'POST') {
        const input = await body(req)
        const lead = sanitizeLead(input.lead)
        if (!lead) { json(res, 400, { error: 'Local inválido.' }); return }
        await pool.query('insert into saved_leads (profile_id,id,lead) values ($1,$2,$3) on conflict (profile_id,id) do nothing', [profileId, lead.id, lead])
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'PATCH') {
        const input = await body(req)
        const id = url.searchParams.get('id')
        if (!id || !stages.has(input.stage) || typeof input.note !== 'string' || input.note.length > 5000) { json(res, 400, { error: 'Dados inválidos.' }); return }
        const result = await pool.query('update saved_leads set stage=$3,note=$4 where profile_id=$1 and id=$2', [profileId, id, input.stage, input.note])
        if (!result.rowCount) { json(res, 404, { error: 'Oportunidade não encontrada.' }); return }
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) { json(res, 400, { error: 'ID obrigatório.' }); return }
        await pool.query('delete from saved_leads where profile_id=$1 and id=$2', [profileId, id])
        json(res, 200, { ok: true }); return
      }
      json(res, 405, { error: 'Método não permitido.' }); return
    }
    if (url.pathname.startsWith('/api/')) { json(res, 404, { error: 'Rota não encontrada.' }); return }
    serveStatic(req, res, url)
  } catch (error) {
    if (error instanceof HttpError) { if (!res.headersSent) json(res, error.status, { error: error.message }); else res.end(); return }
    console.error(error)
    if (!res.headersSent) json(res, 500, { error: 'Erro interno.' }); else res.destroy()
  }
})
server.listen(port, '0.0.0.0', () => console.log(`Client Hunter on port ${port}`))

let stopping = false
function shutdown(signal) {
  if (stopping) return
  stopping = true
  console.log(`${signal} recebido; encerrando…`)
  // Long NDJSON searches would hold server.close() open; give them a few seconds, then exit anyway.
  setTimeout(() => { server.closeAllConnections?.(); process.exit(0) }, 8000).unref()
  server.close(async () => {
    try { await pool?.end() } catch (error) { console.error('Postgres shutdown failed:', error.message) }
    process.exit(0)
  })
  server.closeIdleConnections?.()
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
