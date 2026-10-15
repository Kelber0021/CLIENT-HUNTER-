import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MapContainer, TileLayer, Circle } from 'react-leaflet'
import { svg } from 'leaflet'
import { ArrowDownToLine, ArrowRight, Bookmark, Check, ChevronDown, CircleStop, Compass, Crosshair, ExternalLink, Filter, Globe2, Instagram, LayoutGrid, List, LoaderCircle, Mail, MapPin, Menu, MessageCircle, Phone, RotateCw, Search, SlidersHorizontal, Sparkles, X, Sun, Moon, Star } from 'lucide-react'
import { categories, exportCsv, geocode, instagramUrl, photoUrl, score, searchPlaces, segmentOf, segments, websiteUrl, whatsappUrl, type Lead, type SavedLead, type SearchSummary } from './data'
import { GooglePlacesMap } from './GooglePlacesMap'
import ClusteredLeadMarkers from './ClusteredLeadMarkers'
import { FitSearchArea, MapRadar, RevealSelected, SearchHere } from './MapExtras'
import { CountUp, useOverviewIntro } from './motion'
import './clustered-markers.css'

const initialCenter: [number, number] = [-3.7319, -38.5267]
const stages: SavedLead['stage'][] = ['novo', 'qualificado', 'contatado', 'negociando', 'ganho']
const PAGE = 60
const BINARY_LABS_URL = 'https://binary-labs.onrender.com'
const numberFormat = new Intl.NumberFormat('pt-BR')
const colorOf = (lead: Lead) => segmentOf(lead).color

function AtlasMotion() {
  return <>
    <svg className="atlas-route" viewBox="0 0 600 360" preserveAspectRatio="none" aria-hidden="true">
      <path className="atlas-route-path" pathLength="100" d="M 114 259 C 155 213, 207 261, 254 213 S 290 157, 312 155 S 386 188, 414 132 S 448 89, 474 86" />
    </svg>
    <span className="atlas-pin atlas-pin-a" aria-hidden="true"/>
    <span className="atlas-pin atlas-pin-b" aria-hidden="true"/>
    <span className="atlas-pin atlas-pin-c" aria-hidden="true"/>
    <span className="atlas-scanline" aria-hidden="true"/>
  </>
}
function BinaryLabsCredit({ compact = false }: { compact?: boolean }) {
  return <a className={`made-by${compact ? ' compact' : ''}`} href={BINARY_LABS_URL} target="_blank" rel="noreferrer" aria-label="Produzido pela Binary Labs (abre em nova aba)">
    <span className="made-by-label">Produzido por</span>
    <span className="bl-mark" aria-hidden="true">01</span>
    <strong>Binary Labs</strong>
  </a>
}
/** The search circle uses its own SVG layer so its dashed edge can march while the area is scanned. */
function SearchArea({ center, radiusKm }: { center: [number, number]; radiusKm: number }) {
  const renderer = useMemo(() => svg({ padding: .5 }), [])
  // renderer and className only take effect as creation options, so they are props rather than pathOptions.
  return <Circle center={center} radius={radiusKm * 1000} renderer={renderer} className="search-area" pathOptions={{ color: '#df7147', fillColor: '#df7147', fillOpacity: .07, weight: 1.5, dashArray: '5 6' }}/>
}
function loadSaved(): SavedLead[] { try { return JSON.parse(localStorage.getItem('client-hunter-leads') || '[]') } catch { return [] } }
function storedTheme(): 'light' | 'dark' {
  try { const value = localStorage.getItem('client-hunter-theme'); if (value === 'light' || value === 'dark') return value } catch { /* storage blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function LeadThumbnail({ lead }: { lead: Lead }) {
  const [failed, setFailed] = useState(false)
  const image = photoUrl(lead)
  return <div className="lead-thumb" style={{ '--segment': colorOf(lead) } as CSSProperties}>{image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)}/> : <span className="lead-thumb-monogram" aria-hidden="true">{lead.name.trim()[0]?.toUpperCase()}</span>}</div>
}
function Channels({ lead }: { lead: Lead }) {
  const items = [
    lead.phone && <span key="phone"><Phone size={12}/> Telefone</span>,
    whatsappUrl(lead) && <span key="whatsapp"><MessageCircle size={12}/> WhatsApp</span>,
    instagramUrl(lead) && <span key="instagram"><Instagram size={12}/> Instagram</span>,
    lead.website && <span key="site"><Globe2 size={12}/> Site</span>,
    lead.email && <span key="email"><Mail size={12}/> E-mail</span>,
  ].filter(Boolean)
  return <div className="lead-meta">{items.length ? items : <span className="no-contact">Sem contato público no cadastro</span>}</div>
}
function LeadList({ leads, layout, selectedId, onSelect, resetKey }: { leads: Lead[]; layout: 'list' | 'grid'; selectedId?: string; onSelect: (lead: Lead) => void; resetKey: string }) {
  const [count, setCount] = useState(PAGE)
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMore = count < leads.length
  useEffect(() => { setCount(PAGE); listRef.current?.scrollTo({ top: 0 }) }, [resetKey])
  useEffect(() => {
    const root = listRef.current, target = sentinelRef.current
    if (!root || !target || !hasMore) return
    // Rendering thousands of rows at once freezes phones; rows arrive in pages as the list scrolls.
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) setCount(value => value + PAGE) }, { root, rootMargin: '320px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, count])
  return <div ref={listRef} className={`lead-list ${layout === 'grid' ? 'grid' : ''}`}>
    {leads.slice(0, count).map((lead, index) => {
      const segment = segmentOf(lead)
      return <button key={lead.id} className={`lead-card ${selectedId === lead.id ? 'selected' : ''}`} style={{ '--row-index': index % PAGE, '--segment': segment.color } as CSSProperties} onClick={() => onSelect(lead)}>
        <LeadThumbnail lead={lead}/>
        <div className="lead-main">
          <div className="lead-top"><span className="lead-category"><i aria-hidden="true"/>{segment.label}</span><span className="lead-score" title="Completude dos dados públicos">{score(lead)}% dados</span></div>
          <h3>{lead.name}</h3>
          <p><MapPin size={13}/>{lead.address}{lead.city ? `, ${lead.city}` : ''}</p>
          <Channels lead={lead}/>
        </div>
        <ArrowRight className="lead-arrow" size={17}/>
      </button>
    })}
    {hasMore && <div ref={sentinelRef} className="list-more"><button type="button" onClick={() => setCount(value => value + PAGE)}>Mostrar mais {Math.min(PAGE, leads.length - count)} <span>({numberFormat.format(leads.length - count)} restantes)</span></button></div>}
  </div>
}
function GoogleResults({ places, searched, error }: { places: GooglePlace[]; searched: boolean; error: string }) {
  return <div className="google-results">
    <div className="google-attribution" translate="no">Google Maps</div>
    <p className="google-coverage">Busca complementar: até 20 resultados por consulta, ordenados pela relevância do Google. A lista pode não cobrir toda a região. Avaliações são de usuários do Google Maps.</p>
    {error && <p className="google-error" role="status">{error}</p>}
    {places.length ? <div className="google-list">{places.map(place => <a className="google-place" key={place.id} href={place.googleMapsUrl} target="_blank" rel="noreferrer"><span className="google-place-icon"><MapPin size={18}/></span><span className="google-place-body"><small>{place.category}</small><strong>{place.name}</strong><span>{place.address || 'Endereço não informado'}</span><em><Star size={13}/>{place.rating ? `${place.rating.toFixed(1)} · ${place.userRatingCount || 0} avaliações` : 'Avaliação não disponível'}</em></span><ExternalLink size={16}/></a>)}</div> : <div className="google-empty">{searched ? 'Nenhum resultado complementar nesta busca.' : 'Pesquise uma região para comparar os negócios encontrados.'}</div>}
  </div>
}
function GoogleMapPanel({ center, radiusKm, places }: { center: [number, number]; radiusKm: number; places: GooglePlace[] }) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${center[0]},${center[1]}`
  const hasMapKey = Boolean((import.meta as ImportMeta & { env: { VITE_GOOGLE_MAPS_BROWSER_KEY?: string } }).env.VITE_GOOGLE_MAPS_BROWSER_KEY)
  return hasMapKey ? <GooglePlacesMap places={places} center={center} radiusKm={radiusKm}/> : <div className="google-map-panel"><div className="google-attribution" translate="no">Google Maps</div><MapPin size={33}/><h3>Veja os locais no Google Maps</h3><p>Os resultados desta fonte aparecem na lista. Abra o mapa do Google para conferir a posição e os detalhes de cada negócio.</p><a href={mapsUrl} target="_blank" rel="noreferrer">Abrir esta região <ExternalLink size={16}/></a></div>
}
type StorageMode = 'checking' | 'local' | 'ready' | 'error'
type GooglePlace = { id: string; name: string; category: string; address: string; lat: number; lon: number; rating?: number; userRatingCount?: number; googleMapsUrl: string; source: 'Google Places' }
type GoogleSearch = { places: GooglePlace[]; coverage: { partial: boolean; maxResults: number; reason: string } }
type Progress = { status: string; tilesDone: number; tiles: number }
async function api<T>(path: string, method = 'GET', payload?: object): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Não foi possível salvar os dados. Tente novamente.')
  return data as T
}
function coverageText(summary: SearchSummary | null, count: number, radius: number, place: string) {
  const total = numberFormat.format(count)
  if (!summary) return `${total} estabelecimentos encontrados até agora em até ${radius} km de ${place}.`
  if (summary.sampled) return `${total} locais numa amostra parcial em até ${radius} km de ${place}. A fonte principal não respondeu, então parte da área ficou de fora.`
  if (!summary.complete) return `${total} estabelecimentos em até ${radius} km de ${place}. ${summary.tiles - summary.tilesDone > 0 ? `${summary.tiles - summary.tilesDone} de ${summary.tiles} trechos da área não responderam a tempo.` : 'Parte da área não respondeu a tempo.'}`
  return `${total} estabelecimentos cadastrados no OpenStreetMap em até ${radius} km de ${place}. A área inteira foi consultada.`
}

export default function App() {
  const [view, setView] = useState<'inicio' | 'explorar' | 'salvos'>('inicio')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(storedTheme)
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('client-hunter-theme', theme) } catch { /* storage blocked */ } }, [theme])
  const [location, setLocation] = useState('Fortaleza, CE')
  const [locationPoint, setLocationPoint] = useState<[number, number] | null>(null)
  const [matchedPlace, setMatchedPlace] = useState('')
  const [center, setCenter] = useState<[number, number]>(initialCenter)
  const [searchId, setSearchId] = useState(0)
  const [radius, setRadius] = useState(3)
  const [searchRadius, setSearchRadius] = useState(3)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [summary, setSummary] = useState<SearchSummary | null>(null)
  const [progress, setProgress] = useState<Progress>({ status: '', tilesDone: 0, tiles: 0 })
  const [hiddenSegments, setHiddenSegments] = useState<Set<string>>(() => new Set())
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const [googlePlaces, setGooglePlaces] = useState<GooglePlace[]>([])
  const [googleError, setGoogleError] = useState('')
  const [resultSource, setResultSource] = useState<'osm' | 'google'>('osm')
  const [saved, setSaved] = useState<SavedLead[]>([])
  const [storageMode, setStorageMode] = useState<StorageMode>('checking')
  const [persistenceError, setPersistenceError] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<'score' | 'name'>('score')
  const [layout, setLayout] = useState<'list' | 'grid'>('list')
  const [stageFilter, setStageFilter] = useState('all')
  const searchController = useRef<AbortController | null>(null)
  const overviewRef = useRef<HTMLElement>(null)
  useOverviewIntro(overviewRef)
  useEffect(() => { fetch('/api/google-places/status').then(response => response.json()).then(data => setGoogleAvailable(!!data.available)).catch(() => setGoogleAvailable(false)) }, [])
  useEffect(() => {
    let cancelled = false
    api<{ databaseConfigured: boolean; authenticated: boolean }>('/api/session').then(async session => {
      if (cancelled) return
      if (!session.databaseConfigured) { setSaved(loadSaved()); setStorageMode('local'); return }
      if (!session.authenticated) throw new Error('Não foi possível preparar sua lista neste navegador.')
      const items = await api<SavedLead[]>('/api/leads')
      if (!cancelled) { setSaved(items); setStorageMode('ready') }
    }).catch(err => {
      if (!cancelled) { setPersistenceError(err instanceof Error ? err.message : 'Falha na conexão.'); setStorageMode('error') }
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => { if (storageMode === 'local') try { localStorage.setItem('client-hunter-leads', JSON.stringify(saved)) } catch { /* storage blocked */ } }, [saved, storageMode])
  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected])
  useEffect(() => () => searchController.current?.abort(), [])

  async function refreshSaved() { setSaved(await api<SavedLead[]>('/api/leads')) }

  function useMyLocation() {
    if (!navigator.geolocation) { setError('Seu navegador não oferece localização. Digite uma cidade ou endereço.'); return }
    setError('')
    navigator.geolocation.getCurrentPosition(
      position => {
        const point: [number, number] = [position.coords.latitude, position.coords.longitude]
        setLocationPoint(point); setLocation('Minha localização'); search(point, 'sua localização')
      },
      () => setError('Não foi possível obter sua localização. Permita o acesso no navegador ou digite uma região.'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    )
  }
  function stopSearch() { searchController.current?.abort() }
  async function search(point?: [number, number], pointLabel?: string) {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    const { signal } = controller
    setLoading(true); setError(''); setSelected(null); setProgress({ status: 'Localizando a região…', tilesDone: 0, tiles: 0 })
    const found = new Map<string, Lead>()
    let frame = 0
    const flush = () => { frame = 0; if (!signal.aborted) setLeads([...found.values()]) }
    try {
      let nextCenter = point || locationPoint
      let place = pointLabel || (point ? 'o ponto escolhido no mapa' : location === 'Minha localização' ? 'sua localização' : matchedPlace || location)
      if (!nextCenter) {
        const places = await geocode(location.trim(), signal)
        if (!places.length) throw new Error('Não encontramos esse lugar. Tente cidade e estado, ou bairro e cidade.')
        // For a city, Nominatim ranks the municipal boundary first; its centroid can fall far from downtown.
        const town = places[0].label.split(',')[0]
        const best = places.find(p => ['city', 'town', 'village'].includes(p.type || '') && p.label.split(',')[0] === town) || places[0]
        nextCenter = [best.lat, best.lon]
        place = best.label
      }
      setCenter(nextCenter); setMatchedPlace(place); setSearchRadius(radius); setSearchId(id => id + 1)
      setLeads([]); setSummary(null); setHiddenSegments(new Set()); setSearched(true); setView('explorar')
      setProgress({ status: 'Consultando o OpenStreetMap…', tilesDone: 0, tiles: 0 })
      const googleUrl = `/api/google-places?lat=${nextCenter[0]}&lng=${nextCenter[1]}&radius=${radius * 1000}&segment=${category}`
      const [osm, google] = await Promise.allSettled([
        searchPlaces(nextCenter[0], nextCenter[1], radius, category, { signal, onEvent: event => {
          if (event.type === 'start') setProgress({ status: event.cached === event.tiles && event.tiles ? 'Abrindo áreas já consultadas…' : 'Consultando o OpenStreetMap…', tilesDone: 0, tiles: event.tiles })
          else if (event.type === 'status') setProgress(previous => ({ ...previous, status: event.message }))
          else if (event.type === 'leads') {
            for (const lead of event.leads) found.set(lead.id, lead)
            setProgress(previous => ({ status: event.from === 'sample' ? 'Montando uma amostra parcial…' : previous.status, tilesDone: event.tilesDone, tiles: event.tiles }))
            if (!frame) frame = requestAnimationFrame(flush)
          }
        } }),
        googleAvailable ? fetch(googleUrl, { signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Google Places indisponível.'); return data as GoogleSearch }) : Promise.resolve(null),
      ])
      if (signal.aborted) return
      if (frame) cancelAnimationFrame(frame)
      flush()
      const googleLeads = google.status === 'fulfilled' ? google.value?.places || [] : []
      if (osm.status === 'rejected' && !found.size && !googleLeads.length) throw osm.reason
      setSummary(osm.status === 'fulfilled' ? osm.value : { type: 'done', count: found.size, tilesDone: 0, tiles: 0, complete: false, sampled: false, elapsedMs: 0, dataTimestamp: null })
      setGooglePlaces(googleLeads)
      setGoogleError(google.status === 'rejected' ? (google.reason instanceof Error ? google.reason.message : 'Google Places indisponível.') : '')
      setResultSource(!found.size && googleLeads.length ? 'google' : 'osm')
    } catch (err) {
      if (signal.aborted) return
      setError(err instanceof Error ? err.message : 'Erro ao buscar locais.')
    } finally {
      if (frame) cancelAnimationFrame(frame)
      if (searchController.current === controller) {
        if (signal.aborted && found.size) { setLeads([...found.values()]); setSummary(current => current || { type: 'done', count: found.size, tilesDone: 0, tiles: 0, complete: false, sampled: false, elapsedMs: 0, dataTimestamp: null }) }
        setLoading(false)
        searchController.current = null
      }
    }
  }
  async function toggleSave(lead: Lead) {
    if (saving || storageMode === 'checking') return
    if (storageMode === 'local') { setSaved(prev => prev.some(s => s.lead.id === lead.id) ? prev.filter(s => s.lead.id !== lead.id) : [{ lead, stage: 'novo', note: '', savedAt: Date.now() }, ...prev]); return }
    if (storageMode !== 'ready') { setPersistenceError('Sua lista ainda não está disponível. Tente novamente.'); return }
    setSaving(true); setPersistenceError('')
    try {
      const exists = saved.some(s => s.lead.id === lead.id)
      if (exists) await api(`/api/leads?id=${encodeURIComponent(lead.id)}`, 'DELETE')
      else await api('/api/leads', 'POST', { lead })
      await refreshSaved()
    } catch (err) { setPersistenceError(err instanceof Error ? err.message : 'Não foi possível atualizar a lista.') }
    finally { setSaving(false) }
  }
  async function updateSaved(id: string, patch: Pick<SavedLead, 'stage' | 'note'>) {
    if (saving) return
    if (storageMode === 'local') { setSaved(prev => prev.map(s => s.lead.id === id ? { ...s, ...patch } : s)); return }
    if (storageMode !== 'ready') return
    setSaving(true); setPersistenceError('')
    try { await api(`/api/leads?id=${encodeURIComponent(id)}`, 'PATCH', patch); await refreshSaved() }
    catch (err) { setPersistenceError(err instanceof Error ? err.message : 'Não foi possível atualizar o acompanhamento.') }
    finally { setSaving(false) }
  }
  const base = useMemo(() => view === 'salvos' ? saved.filter(s => stageFilter === 'all' || s.stage === stageFilter).map(s => s.lead) : leads, [view, saved, stageFilter, leads])
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR')
    return needle ? base.filter(l => `${l.name} ${l.category} ${l.address} ${l.city}`.toLocaleLowerCase('pt-BR').includes(needle)) : base
  }, [base, query])
  const segmentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const lead of matching) { const key = segmentOf(lead).value; counts.set(key, (counts.get(key) || 0) + 1) }
    return segments.filter(segment => counts.has(segment.value)).map(segment => ({ ...segment, count: counts.get(segment.value)! }))
  }, [matching])
  const shown = useMemo(() => {
    const visible = hiddenSegments.size ? matching.filter(lead => !hiddenSegments.has(segmentOf(lead).value)) : matching
    const scores = new Map(visible.map(lead => [lead.id, score(lead)]))
    return [...visible].sort((a, b) => sort === 'score' ? scores.get(b.id)! - scores.get(a.id)! || a.name.localeCompare(b.name, 'pt-BR') : a.name.localeCompare(b.name, 'pt-BR'))
  }, [matching, hiddenSegments, sort])
  const googleShown = useMemo(() => googlePlaces.filter(place => `${place.name} ${place.category} ${place.address}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))), [googlePlaces, query])
  const activeSaved = selected && saved.find(s => s.lead.id === selected.id)
  useEffect(() => { setNoteDraft(activeSaved?.note || '') }, [selected?.id, activeSaved?.note])
  const listKey = `${view}|${searchId}|${query}|${sort}|${stageFilter}|${[...hiddenSegments].join(',')}`
  const toggleSegment = (key: string) => setHiddenSegments(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else if (segmentCounts.length > 1 && segmentCounts.every(s => s.value === key || !next.has(s.value))) {
      // First click on a chip isolates that segment; later clicks add or remove segments.
      segmentCounts.forEach(s => { if (s.value !== key) next.add(s.value) })
    } else next.add(key)
    if (segmentCounts.every(s => next.has(s.value))) return new Set()
    return next
  })
  // Nominatim labels are long ("Fortaleza, Região Geográfica Imediata…, Ceará, Brasil"); keep the readable parts.
  const placeName = matchedPlace.split(',').map(part => part.trim()).filter(part => part && !/^(Região|Brasil$|\d{5}-?\d{3}$)/.test(part)).slice(0, 2).join(', ') || location
  const radarProgress = progress.tiles ? progress.tilesDone / progress.tiles : null
  const selectedPoint: [number, number] | undefined = selected ? [selected.lat, selected.lon] : undefined
  const selectedWhatsapp = selected ? whatsappUrl(selected) : undefined
  const selectedInstagram = selected ? instagramUrl(selected) : undefined
  const selectedWebsite = selected ? websiteUrl(selected) : undefined

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Crosshair size={24} strokeWidth={2.5}/></div><div><strong>CLIENT<span>HUNTER</span></strong><small>INTELIGÊNCIA TERRITORIAL</small></div></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav"><button className={view === 'inicio' ? 'active' : ''} onClick={() => { setView('inicio'); setMobileMenu(false) }}><LayoutGrid size={19}/> Visão geral <ArrowRight size={16} className="nav-arrow"/></button><button className={view === 'explorar' ? 'active' : ''} onClick={() => { setView('explorar'); setMobileMenu(false) }}><Compass size={19}/> Explorar território {loading ? <LoaderCircle size={15} className="spin nav-arrow"/> : <ArrowRight size={16} className="nav-arrow"/>}</button><button className={view === 'salvos' ? 'active' : ''} onClick={() => { setView('salvos'); setMobileMenu(false) }}><Bookmark size={19}/> Minha lista <span className="nav-count">{saved.length}</span></button></nav>
      <div className="sidebar-bottom"><div className="sidebar-card"><div className="sidebar-card-icon"><Sparkles size={17}/></div><strong>Seu caderno de campo.</strong><p>Do território à conversa: guarde o que verificou e acompanhe cada abordagem.</p></div><div className="source-note"><span className="online-dot"/> {googleAvailable ? 'OpenStreetMap + Google Maps' : 'Dados abertos via OpenStreetMap'}</div><BinaryLabsCredit compact/></div>
    </aside>
    {mobileMenu && <div className="sidebar-scrim" onClick={() => setMobileMenu(false)}/>}
    <div className="main-area">
      <header className="topbar"><button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu size={22}/></button><div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>{view === 'inicio' ? 'Visão geral' : view === 'explorar' ? 'Explorar território' : 'Minha lista'}</strong></div><div className="top-right"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button><span className="live-pill"><span className="online-dot"/> {storageMode === 'checking' ? 'PREPARANDO LISTA' : 'LISTA NESTE NAVEGADOR'}</span><span className="avatar">CH</span></div></header>
      <main>
        {persistenceError && storageMode === 'ready' && <div className="sync-alert" role="alert">{persistenceError}<button onClick={() => setPersistenceError('')} aria-label="Fechar aviso"><X size={15}/></button></div>}
         {view === 'inicio' ? <section className="overview" ref={overviewRef}>
           <div className="overview-main"><div className="eyebrow intro-fade"><span className="eyebrow-line"/> ATLAS / CLIENT HUNTER</div><h1><span className="intro-line"><span>Da cidade</span></span><span className="intro-line"><span><em>à sua lista.</em></span></span></h1><p className="intro-fade">Escolha o território, confira os negócios no mapa e guarde os contatos que merecem uma abordagem da Binary Labs.</p><button className="intro-fade" onClick={() => setView('explorar')}>Abrir exploração <ArrowRight size={18}/></button><div className="overview-context intro-fade"><span>ÁREA DE PARTIDA</span><strong>{location}</strong><small>Defina outro lugar na exploração</small></div></div>
           <div className="overview-graphic atlas-hero-visual"><img className="atlas-hero-image" src="/atlas-city.webp" alt="Ilustração editorial de uma cidade brasileira vista de cima"/><AtlasMotion/><span className="atlas-coordinate">ATLAS 01 / TERRITÓRIO</span><span className="atlas-status">Pesquisa territorial</span><span className="atlas-hero-caption">Uma visão de cidade para começar. Os locais reais aparecem no mapa após a busca.<small>Ilustração editorial, geografia fictícia</small></span></div>
           <div className="overview-actions"><button onClick={() => setView('explorar')}><Compass size={23}/><strong>Explorar território</strong><span>Escolha cidade, segmento e raio no mapa.</span><ArrowRight size={18}/></button><button onClick={() => setView('salvos')}><Bookmark size={23}/><strong>Minha lista</strong><span>{saved.length ? `${saved.length} oportunidade${saved.length === 1 ? '' : 's'} para acompanhar.` : 'Salve locais para preparar sua abordagem.'}</span><ArrowRight size={18}/></button></div>
           <div className="overview-explain overview-metrics"><div><span>Última busca</span>{searched ? <CountUp className="metric-value" value={leads.length}/> : <strong className="metric-value">—</strong>}<p>{searched ? 'locais encontrados nesta sessão' : 'Explore uma região para ver os locais'}</p></div><div><span>Minha lista</span><CountUp className="metric-value" value={saved.length}/><p>oportunidades salvas neste navegador</p></div><div><span>Em andamento</span><CountUp className="metric-value" value={saved.filter(item => item.stage !== 'novo').length}/><p>contatos com etapa atualizada</p></div></div>
         </section> : view === 'explorar' ? <>
           <section className="hero compact"><div><div className="eyebrow"><span className="eyebrow-line"/> EXPLORAÇÃO / 01</div><h1>Escolha a região.<br/><em>Leia o território.</em></h1><p>Os estabelecimentos encontrados aparecem na lista e no mapa, coloridos por segmento. Confira a fonte antes de abordar.</p></div><div className="explore-visual"><img src="/atlas-city.webp" alt=""/><AtlasMotion/><span>ATLAS URBANO / ILUSTRAÇÃO</span></div></section>
          <section className={`search-panel ${loading ? 'is-searching' : ''}`}><div className="panel-title"><div><SlidersHorizontal size={19}/><strong>Configure sua busca</strong></div><span>01 / DEFINIR TERRITÓRIO</span></div><div className="search-fields"><label className="field location-field"><span>LOCALIZAÇÃO</span><div className="input-icon"><MapPin size={18}/><input value={location} onChange={e => { setLocation(e.target.value); setLocationPoint(null); setMatchedPlace('') }} onKeyDown={e => e.key === 'Enter' && !loading && search()} placeholder="Cidade, bairro ou endereço"/><button className="locate-button" type="button" onClick={useMyLocation} title="Usar minha localização" aria-label="Usar minha localização"><Crosshair size={15}/> <span>Minha localização</span></button></div>{matchedPlace && !loading && <small className="matched-place" title={matchedPlace}>Centro da busca: {matchedPlace}</small>}</label><label className="field category-field"><span>SEGMENTO</span><div className="select-wrap"><Filter size={17}/><select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option value={c.value} key={c.value}>{c.label}</option>)}</select><ChevronDown size={16}/></div></label><label className="field radius-field"><span>RAIO DE BUSCA <b>{radius} km</b></span><input type="range" min="1" max="15" value={radius} onChange={e => setRadius(Number(e.target.value))} style={{ '--fill': `${(radius - 1) / 14 * 100}%` } as CSSProperties}/><div className="range-labels"><span>1 km</span><span>15 km</span></div></label>{loading ? <button className="search-button stop" onClick={stopSearch}><CircleStop size={19}/> Parar busca</button> : <button className="search-button" onClick={() => search()} disabled={!location.trim()}><Search size={19}/> Explorar região <ArrowRight size={18}/></button>}</div>{error && <div className="error" role="alert">{error}</div>}</section>
          <div className="section-heading"><div><div className="eyebrow small">02 / EXPLORAR RESULTADOS</div><h2>Território em foco</h2><p>{searched ? resultSource === 'google' ? `${googlePlaces.length} resultados complementares do Google Maps em até ${searchRadius} km de ${placeName}. A busca mostra no máximo 20 locais e não cobre necessariamente toda a área.` : loading ? `Buscando estabelecimentos em até ${searchRadius} km de ${placeName}…` : coverageText(summary, leads.length, searchRadius, placeName) : 'Defina uma região e comece a descobrir oportunidades.'}{searched && !loading && summary && !summary.complete && resultSource === 'osm' && <button className="inline-retry" onClick={() => search(center, matchedPlace)}><RotateCw size={13}/> Completar a busca</button>}</p></div><div className="heading-stat">{searched ? <CountUp value={resultSource === 'google' ? googlePlaces.length : leads.length}/> : <span>—</span>}<small>{resultSource === 'google' ? 'RESULTADOS GOOGLE' : 'LOCAIS ENCONTRADOS'}</small></div></div>
         </> : <section className="saved-header"><div className="eyebrow"><span className="eyebrow-line"/> CADERNO / 02</div><h1>Lista de<br/><em>abordagem.</em></h1><p>{saved.length ? `${saved.length} oportunidade${saved.length === 1 ? '' : 's'} reunida${saved.length === 1 ? '' : 's'} neste navegador. Atualize a etapa e anote o próximo passo.` : 'Guarde os negócios que quer investigar. Sua lista fica vinculada a este navegador.'}</p><button className="export-button" disabled={!saved.length} onClick={() => exportCsv(saved)}><ArrowDownToLine size={17}/> Exportar CSV</button></section>}
         {view !== 'inicio' && <section className={`results-layout ${view === 'salvos' && saved.length === 0 ? 'empty-saved' : ''}`}><div className="results-column"><div className="results-toolbar"><div><strong>{view === 'salvos' ? 'Lista de prospecção' : 'Estabelecimentos'}</strong><span className="result-count">{numberFormat.format(view === 'explorar' && resultSource === 'google' ? googleShown.length : shown.length)}</span></div>{(view !== 'explorar' || resultSource === 'osm') && <div className="toolbar-actions"><button title="Lista" aria-label="Ver em lista" className={layout === 'list' ? 'selected' : ''} onClick={() => setLayout('list')}><List size={18}/></button><button title="Grade" aria-label="Ver em grade" className={layout === 'grid' ? 'selected' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={18}/></button></div>}</div>{view === 'explorar' && googleAvailable && <div className="source-tabs"><button className={resultSource === 'osm' ? 'active' : ''} onClick={() => setResultSource('osm')}>Mapa aberto <b>{leads.length}</b></button><button className={resultSource === 'google' ? 'active' : ''} onClick={() => setResultSource('google')}>Google Maps <b>{googlePlaces.length}</b></button></div>}<div className="filters-row"><div className="quick-search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrar por nome, rua, bairro..." aria-label="Filtrar resultados"/>{query && <button type="button" className="clear-query" onClick={() => setQuery('')} aria-label="Limpar filtro"><X size={14}/></button>}</div>{view === 'salvos' ? <select className="sort-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)} aria-label="Filtrar por etapa"><option value="all">Todas as etapas</option>{stages.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select> : view === 'explorar' && resultSource === 'google' ? <span className="google-sort-note">Ordenado pelo Google</span> : <select className="sort-select" value={sort} onChange={e => setSort(e.target.value as "score" | "name")} aria-label="Ordenar resultados"><option value="score">Mais completos</option><option value="name">Nome A–Z</option></select>}</div>
          {(view !== 'explorar' || resultSource === 'osm') && segmentCounts.length > 1 && <div className="segment-chips" role="group" aria-label="Mostrar segmentos">{segmentCounts.map(segment => <button key={segment.value} type="button" className={hiddenSegments.has(segment.value) ? 'off' : ''} aria-pressed={!hiddenSegments.has(segment.value)} style={{ '--segment': segment.color } as CSSProperties} onClick={() => toggleSegment(segment.value)}><i aria-hidden="true"/>{segment.label}<b>{numberFormat.format(segment.count)}</b></button>)}{hiddenSegments.size > 0 && <button type="button" className="chips-reset" onClick={() => setHiddenSegments(new Set())}>Mostrar todos</button>}</div>}
          {view === 'explorar' && resultSource === 'google' ? <GoogleResults places={googleShown} searched={searched} error={googleError}/> : shown.length ? <LeadList leads={shown} layout={layout} selectedId={selected?.id} onSelect={setSelected} resetKey={listKey}/> : view === 'explorar' && loading ? <div className="list-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} style={{ '--row-index': index } as CSSProperties}/>)}</div> : <div className="empty-state">{view === 'salvos' ? <img className="empty-illustration" src="/atlas-notes.webp" alt="Ilustração de mapa e anotações"/> : <div><Crosshair size={30}/></div>}<h3>{view === 'salvos' ? 'Sua lista começa aqui' : searched ? 'Nenhum local nesta busca' : 'O mapa espera por você'}</h3><p>{view === 'salvos' ? 'Explore o mapa e salve estabelecimentos para acompanhar.' : searched ? query || hiddenSegments.size ? 'Nenhum resultado com esses filtros. Limpe o filtro ou mostre todos os segmentos.' : 'Amplie o raio ou experimente outro segmento.' : 'Escolha uma localização e clique em “Explorar região”.'}</p>{view === 'salvos' && <button onClick={() => setView('explorar')}>Explorar território <ArrowRight size={15}/></button>}</div>}
           </div>{view === 'explorar' && resultSource === 'google' ? <GoogleMapPanel center={center} radiusKm={searchRadius} places={googleShown}/> : (view !== 'salvos' || saved.length > 0) && <div className="map-column"><div className="map-heading"><div><MapPin size={17}/><strong>VISÃO DO TERRITÓRIO</strong></div><span>{summary?.dataTimestamp ? `OpenStreetMap, dados de ${new Date(summary.dataTimestamp).toLocaleDateString('pt-BR')}` : 'OpenStreetMap'}</span></div><div className={`map-frame ${loading && view === 'explorar' ? 'is-loading' : ''}`}><MapContainer center={initialCenter} zoom={12} preferCanvas={true} scrollWheelZoom={true} zoomControl={false} className="map"><FitSearchArea center={center} radius={searchRadius} searchId={searchId}/><RevealSelected point={selectedPoint}/><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><SearchArea center={center} radiusKm={searchRadius}/><ClusteredLeadMarkers leads={shown} selectedId={selected?.id} onSelect={setSelected} colorOf={colorOf}/>{view === 'explorar' && searched && <SearchHere center={center} radius={searchRadius} disabled={loading} onSearch={point => { setLocation('Ponto escolhido no mapa'); setLocationPoint(point); search(point, 'o ponto escolhido no mapa') }}/>}</MapContainer>{loading && view === 'explorar' && <MapRadar found={leads.length} status={progress.status} progress={radarProgress}/>}<div className="map-overlay"><Crosshair size={15}/>{view === 'salvos' ? `${numberFormat.format(shown.length)} salvos no mapa` : searched ? `${numberFormat.format(shown.length)}${shown.length !== leads.length ? ` de ${numberFormat.format(leads.length)}` : ''} no mapa${summary?.sampled ? ' (amostra)' : ''}` : 'Aguardando busca'}</div></div><div className="map-footer"><span><span className="legend-dot"/> Local</span><span><span className="legend-cluster"/> Grupo de locais</span><span><span className="legend-ring"/> Área de busca</span></div></div>}</section>}
        <footer><span className="footer-product">CLIENT HUNTER <span>© 2026, inteligência territorial para novos negócios</span></span><BinaryLabsCredit/><a className="footer-osm" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Dados © OpenStreetMap <ExternalLink size={12}/></a></footer>
      </main>
    </div>
    {(storageMode === 'checking' || storageMode === 'error') && <div className="access-backdrop"><div className="access-card" role="dialog" aria-modal="true" aria-labelledby="access-title"><div className="access-icon"><Crosshair size={27}/></div><span className="access-eyebrow">CLIENT HUNTER / WORKSPACE</span><h2 id="access-title">{storageMode === 'checking' ? 'Preparando sua lista.' : 'Conexão indisponível.'}</h2><p>{storageMode === 'checking' ? 'Criando sua lista neste navegador e carregando as oportunidades salvas.' : 'Não foi possível abrir sua lista. Confira a conexão e tente novamente.'}</p>{storageMode === 'error' && <button className="access-retry" onClick={() => window.location.reload()}>Tentar novamente</button>}{persistenceError && <div className="access-error" role="alert">{persistenceError}</div>}</div></div>}
    {selected && <><div className="drawer-scrim" onClick={() => setSelected(null)}/><aside className="detail-drawer" aria-label={`Ficha de ${selected.name}`} style={{ '--segment': colorOf(selected) } as CSSProperties}><div className="drawer-head"><span>FICHA DO ESTABELECIMENTO</span><button onClick={() => setSelected(null)} aria-label="Fechar"><X size={21}/></button></div><div className="drawer-body"><span className="lead-category"><i aria-hidden="true"/>{segmentOf(selected).label}</span><h2>{selected.name}</h2><p className="drawer-address"><MapPin size={17}/>{selected.address}{selected.city ? `, ${selected.city}` : ''}</p><div className="data-score"><div><strong>{score(selected)}%</strong><span>COMPLETUDE DOS DADOS</span></div><p>Índice baseado nos campos públicos disponíveis. Não representa visualizações, faturamento ou intenção de compra.</p></div>
      <div className="detail-section"><h4>CONTATOS E PRESENÇA</h4>
        <div className="detail-row"><Phone size={17}/><span>Telefone</span>{selected.phone ? <a href={`tel:${selected.phone.split(/[;,]/)[0].trim()}`}>{selected.phone}</a> : <em>Não informado</em>}</div>
        <div className="detail-row"><MessageCircle size={17}/><span>WhatsApp</span>{selectedWhatsapp ? <a href={selectedWhatsapp} target="_blank" rel="noreferrer">Abrir conversa <ExternalLink size={13}/></a> : <em>Não informado</em>}</div>
        <div className="detail-row"><Instagram size={17}/><span>Instagram</span>{selectedInstagram ? <a href={selectedInstagram} target="_blank" rel="noreferrer">Ver perfil <ExternalLink size={13}/></a> : <em>Não informado</em>}</div>
        <div className="detail-row"><Globe2 size={17}/><span>Website</span>{selectedWebsite ? <a href={selectedWebsite} target="_blank" rel="noreferrer">Abrir site <ExternalLink size={13}/></a> : <em>Não informado</em>}</div>
        <div className="detail-row"><Mail size={17}/><span>E-mail</span>{selected.email ? <a href={`mailto:${selected.email}`}>{selected.email}</a> : <em>Não informado</em>}</div>
        <div className="detail-row"><Compass size={17}/><span>Horário</span><em>{selected.openingHours || 'Não informado'}</em></div>
      </div>
      <div className="detail-section"><h4>VERIFICAR E PESQUISAR</h4><p className="detail-hint">Confira avaliações e movimento diretamente no Google Maps antes de priorizar a abordagem.</p><a className="external-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.name} ${selected.address === 'Endereço não informado' ? '' : selected.address} ${selected.city}`.trim())}`} target="_blank" rel="noreferrer">Abrir no Google Maps <ExternalLink size={16}/></a><a className="external-link secondary" href={selected.osmUrl} target="_blank" rel="noreferrer">Ver fonte no OpenStreetMap <ExternalLink size={16}/></a></div>{activeSaved && <div className="detail-section"><h4>ACOMPANHAMENTO</h4><label className="drawer-label">Etapa<select value={activeSaved.stage} onChange={e => updateSaved(selected.id, { stage: e.target.value as SavedLead['stage'], note: noteDraft })} disabled={saving}>{stages.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label><label className="drawer-label">Observações<textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} disabled={saving} placeholder="Anote o contexto para sua abordagem..." rows={4}/></label><button className="save-note-button" disabled={saving || noteDraft === activeSaved.note} onClick={() => updateSaved(selected.id, { stage: activeSaved.stage, note: noteDraft })}>Salvar observação</button></div>}</div><div className="drawer-footer"><button className={activeSaved ? 'saved-button' : 'save-button'} onClick={() => toggleSave(selected)} disabled={saving || storageMode === 'checking'}>{activeSaved ? <Check size={18}/> : <Bookmark size={18}/>} {activeSaved ? 'Salvo na minha lista' : 'Salvar oportunidade'}</button></div></aside></>}
  </div>
}
