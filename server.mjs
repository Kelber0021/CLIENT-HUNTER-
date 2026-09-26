import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import pg from 'pg'
import { handleSample } from './osm-sample.mjs'

const dist = resolve('dist')
const port = Number(process.env.PORT || 4173)
const password = process.env.APP_PASSWORD
const sessionSecret = process.env.SESSION_SECRET
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }) : null
const stages = new Set(['novo', 'qualificado', 'contatado', 'negociando', 'ganho'])
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

if (pool) {
  await pool.query(`create table if not exists saved_leads (
    id text primary key,
    lead jsonb not null,
    stage text not null default 'novo' check (stage in ('novo','qualificado','contatado','negociando','ganho')),
    note text not null default '',
    saved_at timestamptz not null default now()
  )`)
}

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
async function body(req) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 262144) throw new Error('Payload too large') }
  return JSON.parse(raw || '{}')
}
function signature(expires) { return createHmac('sha256', sessionSecret || '').update(expires).digest('hex') }
function authed(req) {
  if (!pool || !password || !sessionSecret) return false
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)ch_session=([^;]+)/)?.[1]
  if (!cookie) return false
  const [expires, sig] = cookie.split('.')
  if (!expires || !sig || Number(expires) < Date.now()) return false
  const expected = signature(expires)
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}
function setCookie(res, value, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `ch_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${value ? 604800 : 0}${secure}`)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/api/health') { json(res, 200, { ok: true, database: !!pool }); return }
    if (url.pathname === '/api/osm-sample' && req.method === 'GET') { await handleSample(req, res); return }
    if (url.pathname === '/api/session') {
      if (req.method === 'GET') { json(res, 200, { databaseConfigured: !!pool, authConfigured: !!password && !!sessionSecret, authenticated: authed(req) }); return }
      if (req.method === 'DELETE') { setCookie(res, '', req); json(res, 200, { authenticated: false }); return }
      if (req.method === 'POST') {
        if (!pool || !password || !sessionSecret) { json(res, 503, { error: 'Acesso ainda não configurado.' }); return }
        const input = await body(req)
        const entered = createHash('sha256').update(String(input.password || '')).digest()
        const expected = createHash('sha256').update(password).digest()
        if (!timingSafeEqual(entered, expected)) { json(res, 401, { error: 'Senha incorreta.' }); return }
        const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000)
        setCookie(res, `${expires}.${signature(expires)}`, req)
        json(res, 200, { authenticated: true }); return
      }
    }
    if (url.pathname === '/api/leads') {
      if (!pool || !password || !sessionSecret) { json(res, 503, { error: 'Banco ou acesso não configurado.' }); return }
      if (!authed(req)) { json(res, 401, { error: 'Acesso necessário.' }); return }
      if (req.method === 'GET') {
        const rows = await pool.query('select lead, stage, note, extract(epoch from saved_at) * 1000 as "savedAt" from saved_leads order by saved_at desc')
        json(res, 200, rows.rows); return
      }
      if (req.method === 'POST') {
        const input = await body(req)
        const lead = input.lead
        if (!lead || typeof lead.id !== 'string' || !/^(node|way|relation)\/\d+$/.test(lead.id) || typeof lead.name !== 'string' || lead.name.length > 200) { json(res, 400, { error: 'Local inválido.' }); return }
        await pool.query('insert into saved_leads (id,lead) values ($1,$2) on conflict (id) do nothing', [lead.id, lead])
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'PATCH') {
        const input = await body(req)
        const id = url.searchParams.get('id')
        if (!id || !stages.has(input.stage) || typeof input.note !== 'string' || input.note.length > 5000) { json(res, 400, { error: 'Dados inválidos.' }); return }
        await pool.query('update saved_leads set stage=$2,note=$3 where id=$1', [id, input.stage, input.note])
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) { json(res, 400, { error: 'ID obrigatório.' }); return }
        await pool.query('delete from saved_leads where id=$1', [id])
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
