const decode = value => value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
const attrs = xml => Object.fromEntries([...xml.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]))
const wanted = t => !!(t.name && (['restaurant', 'bar', 'fast_food', 'cafe', 'clinic', 'dentist', 'doctors', 'pharmacy'].includes(t.amenity) || t.shop || ['fitness_centre', 'sports_centre'].includes(t.leisure) || ['hotel', 'guest_house', 'hostel'].includes(t.tourism) || t.office))
const isCategory = (t, category) => {
  if (category === 'all') return true
  if (category === 'restaurant') return ['restaurant', 'bar', 'fast_food'].includes(t.amenity)
  if (category === 'cafe') return t.amenity === 'cafe' || t.shop === 'bakery'
  if (category === 'shop') return !!t.shop
  if (category === 'beauty') return ['beauty', 'hairdresser', 'cosmetics'].includes(t.shop)
  if (category === 'health') return ['clinic', 'dentist', 'doctors', 'pharmacy'].includes(t.amenity)
  if (category === 'fitness') return ['fitness_centre', 'sports_centre'].includes(t.leisure)
  if (category === 'hotel') return ['hotel', 'guest_house', 'hostel'].includes(t.tourism)
  if (category === 'office') return !!t.office
  return true
}
const tileCache = new Map()
async function osmTile(lat, lon, half = 0.009, depth = 0) {
  const bbox = [lon - half, lat - half, lon + half, lat + half].join(',')
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'ClientHunter/0.1 (local development)' } })
  if (response.status === 400 && depth < 1) {
    const reason = await response.text()
    if (reason.includes('too many nodes')) {
      const childHalf = half / 2
      const offsets = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      const children = await Promise.all(offsets.map(([north, east]) => osmTile(lat + north * childHalf, lon + east * childHalf, childHalf, depth + 1)))
      return children.flat()
    }
  }
  if (!response.ok) throw new Error('A fonte de dados está temporariamente indisponível.')
  const xml = await response.text()
  const nodes = new Map()
  const elements = []
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/\>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(match[1]); const latN = Number(a.lat), lonN = Number(a.lon)
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) continue
    nodes.set(a.id, { lat: latN, lon: lonN })
    const tags = Object.fromEntries([...((match[2] || '').matchAll(/<tag\b([^>]*?)\/>/g))].map(m => { const t = attrs(m[1]); return [t.k, t.v] }))
    if (wanted(tags)) elements.push({ id: Number(a.id), type: 'node', lat: latN, lon: lonN, tags: { ...tags, 'client_hunter:sample': 'true' } })
  }
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(match[1])
    const tags = Object.fromEntries([...match[2].matchAll(/<tag\b([^>]*?)\/>/g)].map(m => { const t = attrs(m[1]); return [t.k, t.v] }))
    if (!wanted(tags)) continue
    const refs = [...match[2].matchAll(/<nd\b([^>]*?)\/>/g)].map(m => nodes.get(attrs(m[1]).ref)).filter(Boolean)
    if (!refs.length) continue
    const center = { lat: refs.reduce((sum, n) => sum + n.lat, 0) / refs.length, lon: refs.reduce((sum, n) => sum + n.lon, 0) / refs.length }
    elements.push({ id: Number(a.id), type: 'way', center, tags: { ...tags, 'client_hunter:sample': 'true' } })
  }
  return elements
}

function cachedTile(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`
  const cached = tileCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.promise
  const promise = osmTile(lat, lon)
  tileCache.set(key, { promise, expires: Date.now() + 5 * 60_000 })
  promise.catch(() => tileCache.delete(key))
  return promise
}

function distanceKm(a, b, lat, lon) {
  const dLat = (a - lat) * Math.PI / 180
  const dLon = (b - lon) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export async function osmSample(lat, lon, category, radiusKm) {
  const points = [[lat, lon]]
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]]
  for (let km = 1; km <= radiusKm; km++) {
    const [north, east] = directions[(km - 1) % directions.length]
    const distance = km - 0.35
    points.push([lat + north * distance / 111.2, lon + east * distance / (111.2 * Math.cos(lat * Math.PI / 180))])
  }
  const chunks = []
  let completedPoints = 0
  for (let i = 0; i < points.length; i += 3) {
    const batch = await Promise.allSettled(points.slice(i, i + 3).map(([a, b]) => cachedTile(a, b)))
    for (const result of batch) if (result.status === 'fulfilled') { chunks.push(...result.value); completedPoints++ }
  }
  if (!completedPoints) throw new Error('Não foi possível consultar os pontos da região.')
  const unique = new Map()
  for (const element of chunks) {
    const point = element.center || element
    if (isCategory(element.tags, category) && distanceKm(point.lat, point.lon, lat, lon) <= radiusKm) unique.set(`${element.type}/${element.id}`, element)
  }
  return { elements: [...unique.values()], sampled: true, sampledPoints: completedPoints, radiusKm }
}

export async function handleSample(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost')
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'))
    const category = url.searchParams.get('category') || 'all'
    const radiusKm = Number(url.searchParams.get('radius'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 15) { res.writeHead(400); res.end('Invalid coordinates or radius'); return }
    const data = await osmSample(lat, lon, category, radiusKm)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
    res.end(JSON.stringify(data))
  } catch (error) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })) }
}
