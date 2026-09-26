export type Lead = {
  id: string; name: string; category: string; address: string; city: string;
  lat: number; lon: number; phone?: string; website?: string; openingHours?: string;
  osmUrl: string; source: 'OpenStreetMap'; tags: Record<string, string>;
}
export type SavedLead = { lead: Lead; stage: 'novo' | 'qualificado' | 'contatado' | 'negociando' | 'ganho'; note: string; savedAt: number }

export const categories = [
  { value: 'all', label: 'Todos os segmentos' },
  { value: 'restaurant', label: 'Restaurantes e bares' },
  { value: 'cafe', label: 'Cafés e padarias' },
  { value: 'shop', label: 'Lojas e varejo' },
  { value: 'beauty', label: 'Beleza e estética' },
  { value: 'health', label: 'Saúde e clínicas' },
  { value: 'fitness', label: 'Academias e esporte' },
  { value: 'hotel', label: 'Hotéis e hospedagem' },
  { value: 'office', label: 'Escritórios e serviços' },
]

const filters: Record<string, string> = {
  restaurant: '["amenity"~"^(restaurant|bar|fast_food)$"]',
  cafe: '["amenity"~"^(cafe|bakery)$"]',
  shop: '["shop"]',
  beauty: '["shop"~"^(beauty|hairdresser|cosmetics)$"]',
  health: '["amenity"~"^(clinic|dentist|doctors|pharmacy)$"]',
  fitness: '["leisure"~"^(fitness_centre|sports_centre)$"]',
  hotel: '["tourism"~"^(hotel|guest_house|hostel)$"]',
  office: '["office"]',
}

export function categoryOf(tags: Record<string, string>) {
  if (tags.amenity === 'restaurant' || tags.amenity === 'bar' || tags.amenity === 'fast_food') return 'Restaurantes e bares'
  if (tags.amenity === 'cafe' || tags.shop === 'bakery') return 'Cafés e padarias'
  if (tags.shop === 'beauty' || tags.shop === 'hairdresser' || tags.shop === 'cosmetics') return 'Beleza e estética'
  if (tags.amenity === 'clinic' || tags.amenity === 'dentist' || tags.amenity === 'doctors' || tags.amenity === 'pharmacy') return 'Saúde e clínicas'
  if (tags.leisure === 'fitness_centre' || tags.leisure === 'sports_centre') return 'Academias e esporte'
  if (tags.tourism) return 'Hotéis e hospedagem'
  if (tags.office) return 'Escritórios e serviços'
  if (tags.leisure) return 'Lazer e eventos'
  if (tags.amenity) return 'Serviços locais'
  return 'Lojas e varejo'
}

export async function geocode(query: string, signal?: AbortSignal) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '5')
  url.searchParams.set('addressdetails', '1')
  const response = await fetch(url, { signal, headers: { 'Accept-Language': 'pt-BR' } })
  if (!response.ok) throw new Error('Não foi possível localizar essa região.')
  return await response.json() as { lat: string; lon: string; display_name: string; addresstype?: string }[]
}

export async function findLeads(lat: number, lon: number, radiusKm: number, category: string, signal?: AbortSignal): Promise<Lead[]> {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat},${lon})`
  const clauses = category === 'all'
    ? ['["amenity"~"^(restaurant|bar|fast_food|cafe|clinic|dentist|doctors|pharmacy)$"]', '["shop"]', '["leisure"~"^(fitness_centre|sports_centre)$"]', '["tourism"~"^(hotel|guest_house|hostel)$"]', '["office"]']
    : [filters[category]]
  const query = `[out:json][timeout:25];(${clauses.map(c => `nwr${c}${around};`).join('')});out center 350;`
  type OsmData = { elements: { id: number; type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }
  let data: OsmData
  try {
    const response = await fetch('https://overpass.private.coffee/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error('Overpass unavailable')
    data = await response.json() as OsmData
  } catch {
    const fallback = await fetch(`/api/osm-sample?lat=${lat}&lon=${lon}&category=${category}`, { signal })
    if (!fallback.ok) throw new Error('As fontes de dados estão indisponíveis. Tente novamente em instantes.')
    data = await fallback.json() as OsmData
  }
  return data.elements.filter(e => e.tags?.name && (e.lat !== undefined || e.center)).map(e => {
    const tags = e.tags || {}
    const point = e.center || { lat: e.lat!, lon: e.lon! }
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ')
    return { id: `${e.type}/${e.id}`, name: tags.name, category: categoryOf(tags), address: street || tags['addr:full'] || 'Endereço não informado', city: tags['addr:city'] || '', lat: point.lat, lon: point.lon, phone: tags.phone || tags['contact:phone'], website: tags.website || tags['contact:website'], openingHours: tags.opening_hours, osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`, source: 'OpenStreetMap', tags }
  })
}

export function score(lead: Lead) {
  const signals = [lead.phone, lead.website, lead.openingHours, lead.address !== 'Endereço não informado' ? lead.address : '', lead.tags['addr:postcode'], lead.tags['contact:instagram'] || lead.tags['contact:facebook']]
  return Math.min(100, 35 + signals.filter(Boolean).length * 11)
}

export function photoUrl(lead: Lead) {
  const raw = lead.tags.image || lead.tags['contact:image'] || lead.tags.wikimedia_commons
  if (!raw) return undefined
  if (/^https:\/\//i.test(raw)) return raw
  const file = raw.replace(/^File:/i, '')
  if (/\.(jpe?g|png|webp)$/i.test(file)) return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(file)}`
  return undefined
}

export function exportCsv(items: SavedLead[]) {
  const columns = ['Nome', 'Segmento', 'Endereço', 'Cidade', 'Telefone', 'Site', 'Etapa', 'Observações', 'OpenStreetMap']
  const rows = items.map(({ lead, stage, note }) => [lead.name, lead.category, lead.address, lead.city, lead.phone || '', lead.website || '', stage, note, lead.osmUrl])
  const csv = [columns, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'client-hunter-leads.csv'; a.click(); URL.revokeObjectURL(a.href)
}
