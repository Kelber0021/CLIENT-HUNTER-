import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import pg from 'pg'
import { handleSample } from './osm-sample.mjs'

const dist = resolve('dist')
const port = Number(process.env.PORT || 4173)
// Local-only sessions can use an ephemeral key; persistent deployments must set SESSION_SECRET.
const sessionSecret = process.env.SESSION_SECRET || (!process.env.DATABASE_URL ? randomUUID() : null)
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }) : null
const stages = new Set(['novo', 'qualificado', 'contatado', 'negociando', 'ganho'])
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' }

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
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
async function body(req) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 262144) throw new Error('Payload too large') }
  return JSON.parse(raw || '{}')
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
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const value = `${id}.${expires}.${signature(`${id}.${expires}`)}`
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `ch_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`)
}
function session(req, res) {
  if (!sessionSecret) { json(res, 503, { error: 'Sessão não configurada.' }); return null }
  let id = profile(req)
  if (!id) id = randomUUID()
  setCookie(res, id, req)
  return id
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/api/health') { json(res, 200, { ok: true, database: !!pool }); return }
    if (url.pathname === '/api/osm-sample' && req.method === 'GET') { await handleSample(req, res); return }
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
        const lead = input.lead
        if (!lead || typeof lead.id !== 'string' || !/^(node|way|relation)\/\d+$/.test(lead.id) || typeof lead.name !== 'string' || lead.name.length > 200) { json(res, 400, { error: 'Local inválido.' }); return }
        await pool.query('insert into saved_leads (profile_id,id,lead) values ($1,$2,$3) on conflict (profile_id,id) do nothing', [profileId, lead.id, lead])
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'PATCH') {
        const input = await body(req)
        const id = url.searchParams.get('id')
        if (!id || !stages.has(input.stage) || typeof input.note !== 'string' || input.note.length > 5000) { json(res, 400, { error: 'Dados inválidos.' }); return }
        await pool.query('update saved_leads set stage=$3,note=$4 where profile_id=$1 and id=$2', [profileId, id, input.stage, input.note])
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
    const requested = resolve(dist, `.${url.pathname}`)
    const file = requested.startsWith(dist) && existsSync(requested) && extname(requested) ? requested : resolve(dist, 'index.html')
    if (!existsSync(file)) { json(res, 503, { error: 'Execute npm run build antes de iniciar o servidor.' }); return }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' })
    createReadStream(file).pipe(res)
  } catch (error) { console.error(error); json(res, 500, { error: 'Erro interno.' }) }
})
server.listen(port, '0.0.0.0', () => console.log(`Client Hunter on port ${port}`))
