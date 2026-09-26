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
export async function osmSample(lat, lon, category) {
  const half = 0.004
  const bbox = [lon - half, lat - half, lon + half, lat + half].join(',')
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'ClientHunter/0.1 (local development)' } })
  if (!response.ok) throw new Error('A fonte de dados está temporariamente indisponível.')
  const xml = await response.text()
  const nodes = new Map()
  const elements = []
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/\>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(match[1]); const latN = Number(a.lat), lonN = Number(a.lon)
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) continue
    nodes.set(a.id, { lat: latN, lon: lonN })
    const tags = Object.fromEntries([...((match[2] || '').matchAll(/<tag\b([^>]*?)\/>/g))].map(m => { const t = attrs(m[1]); return [t.k, t.v] }))
    if (wanted(tags) && isCategory(tags, category)) elements.push({ id: Number(a.id), type: 'node', lat: latN, lon: lonN, tags: { ...tags, 'client_hunter:sample': 'true' } })
  }
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(match[1])
    const tags = Object.fromEntries([...match[2].matchAll(/<tag\b([^>]*?)\/>/g)].map(m => { const t = attrs(m[1]); return [t.k, t.v] }))
    if (!wanted(tags) || !isCategory(tags, category)) continue
    const refs = [...match[2].matchAll(/<nd\b([^>]*?)\/>/g)].map(m => nodes.get(attrs(m[1]).ref)).filter(Boolean)
    if (!refs.length) continue
    const center = { lat: refs.reduce((sum, n) => sum + n.lat, 0) / refs.length, lon: refs.reduce((sum, n) => sum + n.lon, 0) / refs.length }
    elements.push({ id: Number(a.id), type: 'way', center, tags: { ...tags, 'client_hunter:sample': 'true' } })
  }
  return { elements: elements.slice(0, 350) }
}

export async function handleSample(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost')
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'))
    const category = url.searchParams.get('category') || 'all'
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { res.writeHead(400); res.end('Invalid coordinates'); return }
    const data = await osmSample(lat, lon, category)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
    res.end(JSON.stringify(data))
  } catch (error) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })) }
}
