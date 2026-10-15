export type CategoryKey = 'restaurant' | 'cafe' | 'shop' | 'beauty' | 'health' | 'fitness' | 'hotel' | 'auto' | 'education' | 'office'
export type Lead = {
  id: string; name: string; category: string; categoryKey?: string; address: string; city: string;
  lat: number; lon: number; phone?: string; website?: string; email?: string; instagram?: string; whatsapp?: string; facebook?: string; openingHours?: string;
  osmUrl: string; source: 'OpenStreetMap'; tags: Record<string, string>;
}
export type SavedLead = { lead: Lead; stage: 'novo' | 'qualificado' | 'contatado' | 'negociando' | 'ganho'; note: string; savedAt: number }

// Cores de legenda cartográfica: cada segmento tem sua tinta no mapa e na lista.
export const segments: { value: CategoryKey; label: string; color: string }[] = [
  { value: 'restaurant', label: 'Restaurantes e bares', color: '#d65f37' },
  { value: 'cafe', label: 'Cafés e padarias', color: '#94613a' },
  { value: 'shop', label: 'Lojas e varejo', color: '#2b82a8' },
  { value: 'beauty', label: 'Beleza e estética', color: '#c2508c' },
  { value: 'health', label: 'Saúde e clínicas', color: '#1f9a77' },
  { value: 'fitness', label: 'Academias e esporte', color: '#6f9c2a' },
  { value: 'hotel', label: 'Hotéis e hospedagem', color: '#7d5cc4' },
  { value: 'auto', label: 'Automotivo', color: '#5d6b78' },
  { value: 'education', label: 'Cursos e escolas livres', color: '#d99b12' },
  { value: 'office', label: 'Escritórios e serviços', color: '#3d50b5' },
]
export const categories = [{ value: 'all', label: 'Todos os segmentos' }, ...segments.map(({ value, label }) => ({ value, label }))]
const byKey = new Map<string, (typeof segments)[number]>(segments.map(s => [s.value, s]))
const byLabel = new Map<string, (typeof segments)[number]>(segments.map(s => [s.label, s]))

/** Leads salvos antes desta versão só têm o rótulo; o segmento é deduzido dele. */
export function segmentOf(lead: Pick<Lead, 'categoryKey' | 'category'>) {
  return byKey.get(lead.categoryKey || '') || byLabel.get(lead.category) || byKey.get('shop')!
}

export type GeoPlace = { lat: number; lon: number; label: string; type?: string }

export async function geocode(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal })
    if (response.ok) return await response.json() as GeoPlace[]
    if (response.status === 400) return []
  } catch (error) { if (signal?.aborted) throw error }
  // Sem o servidor (prévia estática), consulta o Nominatim diretamente.
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '5')
  const response = await fetch(url, { signal, headers: { 'Accept-Language': 'pt-BR' } })
  if (!response.ok) throw new Error('Não foi possível localizar essa região agora. Tente de novo em instantes.')
  const places = await response.json() as { lat: string; lon: string; display_name: string; addresstype?: string }[]
  return places.map(place => ({ lat: Number(place.lat), lon: Number(place.lon), label: place.display_name, type: place.addresstype }))
}

export type SearchEvent =
  | { type: 'start'; tiles: number; cached: number; radiusKm: number; category: string }
  | { type: 'leads'; leads: Lead[]; tilesDone: number; tiles: number; from: 'cache' | 'overpass' | 'sample' }
  | { type: 'status'; message: string }
  | { type: 'done'; count: number; tilesDone: number; tiles: number; complete: boolean; sampled: boolean; elapsedMs: number; dataTimestamp: string | null }
  | { type: 'error'; message: string }
export type SearchSummary = Extract<SearchEvent, { type: 'done' }>

/** Lê a busca do servidor em NDJSON: cada linha chega assim que uma parte da área é carregada. */
export async function searchPlaces(lat: number, lon: number, radiusKm: number, category: string, { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: SearchEvent) => void }): Promise<SearchSummary> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radiusKm), category })
  const response = await fetch(`/api/places?${params}`, { signal })
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || 'Não foi possível buscar os locais agora. Tente de novo em instantes.')
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let received = 0
  let summary: SearchSummary | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as SearchEvent
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'leads') { event.leads = event.leads.filter(lead => Number.isFinite(lead.lat) && Number.isFinite(lead.lon)); received += event.leads.length }
    if (event.type === 'done') summary = event
    onEvent(event)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(handle)
  }
  handle(buffer)
  if (summary) return summary
  if (!received) throw new Error('A busca foi interrompida antes de trazer resultados. Tente de novo.')
  return { type: 'done', count: received, tilesDone: 0, tiles: 0, complete: false, sampled: false, elapsedMs: 0, dataTimestamp: null }
}

export function score(lead: Lead) {
  const signals = [lead.phone, lead.website, lead.openingHours, lead.address !== 'Endereço não informado' ? lead.address : '', lead.tags['addr:postcode'], lead.instagram || lead.facebook || lead.whatsapp || lead.email || lead.tags['contact:instagram'] || lead.tags['contact:facebook']]
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

/** WhatsApp só quando o cadastro informa, ou quando o telefone tem cara de celular brasileiro. */
export function whatsappUrl(lead: Lead) {
  const raw = lead.whatsapp || lead.phone
  if (!raw) return undefined
  let digits = raw.split(/[;,/]/)[0].replace(/\D/g, '')
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  const local = digits.startsWith('55') ? digits.slice(2) : ''
  if (!lead.whatsapp && !(local.length === 11 && local[2] === '9')) return undefined
  return digits.length >= 12 && digits.length <= 13 ? `https://wa.me/${digits}` : undefined
}

export function instagramUrl(lead: Lead) {
  const raw = (lead.instagram || lead.tags['contact:instagram'] || '').trim()
  if (!raw) return undefined
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:/i, 'https:')
  const handle = raw.replace(/^@/, '').replace(/^(www\.)?instagram\.com\//i, '').split(/[/?#\s]/)[0]
  return handle ? `https://www.instagram.com/${encodeURIComponent(handle)}` : undefined
}

export function websiteUrl(lead: Lead) {
  return lead.website ? (/^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`) : undefined
}

export function exportCsv(items: SavedLead[]) {
  const columns = ['Nome', 'Segmento', 'Endereço', 'Cidade', 'Telefone', 'WhatsApp', 'E-mail', 'Instagram', 'Site', 'Etapa', 'Observações', 'Latitude', 'Longitude', 'OpenStreetMap']
  const rows = items.map(({ lead, stage, note }) => [lead.name, lead.category, lead.address, lead.city, lead.phone || '', whatsappUrl(lead) || '', lead.email || '', instagramUrl(lead) || '', lead.website || '', stage, note, lead.lat, lead.lon, lead.osmUrl])
  // Aspas duplas e prefixo de fórmula neutralizados para abrir com segurança em planilhas.
  const cell = (value: unknown) => `"${(typeof value === 'string' ? value.replace(/^[=+\-@]/, "'$&") : String(value)).replaceAll('"', '""')}"`
  const csv = [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'client-hunter-leads.csv'; a.click(); URL.revokeObjectURL(a.href)
}
