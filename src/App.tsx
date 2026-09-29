import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { ArrowDownToLine, ArrowRight, Bookmark, Check, ChevronDown, Compass, Crosshair, ExternalLink, Filter, Globe2, LayoutGrid, List, LoaderCircle, MapPin, Menu, Phone, Search, SlidersHorizontal, Sparkles, X, Sun, Moon, Star } from 'lucide-react'
import { categories, exportCsv, findLeads, geocode, score, photoUrl, type Lead, type SavedLead } from './data'

const initialCenter: [number, number] = [-3.7319, -38.5267]
const stages: SavedLead['stage'][] = ['novo', 'qualificado', 'contatado', 'negociando', 'ganho']
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
function FitSearchArea({ center, radius }: { center: [number, number]; radius: number }) {
  const map = useMap()
  useEffect(() => {
    const latDelta = radius / 111.2
    const lonDelta = radius / (111.2 * Math.cos(center[0] * Math.PI / 180))
    map.invalidateSize()
    map.flyToBounds([[center[0] - latDelta, center[1] - lonDelta], [center[0] + latDelta, center[1] + lonDelta]], { padding: [25, 25], maxZoom: 14, duration: 1.1 })
  }, [center, radius, map])
  return null
}
function loadSaved(): SavedLead[] { try { return JSON.parse(localStorage.getItem('client-hunter-leads') || '[]') } catch { return [] } }
function LeadThumbnail({ lead }: { lead: Lead }) {
  const [failed, setFailed] = useState(false)
  const image = photoUrl(lead)
  return <div className="lead-thumb">{image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)}/> : <span className="lead-thumb-monogram" aria-hidden="true">{lead.name.trim()[0]?.toUpperCase()}</span>}</div>
}
type StorageMode = 'checking' | 'local' | 'ready' | 'error'
async function api<T>(path: string, method = 'GET', payload?: object): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Não foi possível salvar os dados. Tente novamente.')
  return data as T
}

export default function App() {
  const [view, setView] = useState<'inicio' | 'explorar' | 'salvos'>('inicio')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('client-hunter-theme') as 'light' | 'dark') || 'light')
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('client-hunter-theme', theme) }, [theme])
  const [location, setLocation] = useState('Fortaleza, CE')
  const [locationPoint, setLocationPoint] = useState<[number, number] | null>(null)
  const [center, setCenter] = useState<[number, number]>(initialCenter)
  const [radius, setRadius] = useState(3)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [sampledPoints, setSampledPoints] = useState<number | null>(null)
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
  useEffect(() => { if (storageMode === 'local') localStorage.setItem('client-hunter-leads', JSON.stringify(saved)) }, [saved, storageMode])

  async function refreshSaved() { setSaved(await api<SavedLead[]>('/api/leads')) }

  function useMyLocation() {
    if (!navigator.geolocation) { setError('Seu navegador não oferece localização. Digite uma cidade ou endereço.'); return }
    setError('')
    navigator.geolocation.getCurrentPosition(
      position => {
        const point: [number, number] = [position.coords.latitude, position.coords.longitude]
        setLocationPoint(point); setLocation('Minha localização'); search(point)
      },
      () => setError('Não foi possível obter sua localização. Permita o acesso no navegador ou digite uma região.'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    )
  }
  async function search(point?: [number, number]) {
    setLoading(true); setError(''); setSelected(null)
    try {
      let nextCenter = point || locationPoint
      if (!nextCenter) {
        const places = await geocode(location.trim())
        if (!places.length) throw new Error('Local não encontrado. Tente cidade, estado ou bairro.')
        const place = places.find(p => p.addresstype === 'city' || p.addresstype === 'town' || p.addresstype === 'village') || places[0]
        nextCenter = [Number(place.lat), Number(place.lon)]
      }
      setCenter(nextCenter)
      const result = await findLeads(...nextCenter, radius, category)
      setLeads(result.leads); setSampledPoints(result.sampled ? result.sampledPoints : null); setSearched(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao buscar locais.') }
    finally { setLoading(false) }
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
  const shown = useMemo(() => {
    const list = view === 'salvos' ? saved.filter(s => stageFilter === 'all' || s.stage === stageFilter).map(s => s.lead) : leads
    return list.filter(l => `${l.name} ${l.category} ${l.address}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).sort((a, b) => sort === 'score' ? score(b) - score(a) : a.name.localeCompare(b.name, 'pt-BR'))
  }, [view, saved, stageFilter, leads, query, sort])
  const activeSaved = selected && saved.find(s => s.lead.id === selected.id)
  useEffect(() => { setNoteDraft(activeSaved?.note || '') }, [selected?.id, activeSaved?.note])

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Crosshair size={24} strokeWidth={2.5}/></div><div><strong>CLIENT<span>HUNTER</span></strong><small>INTELIGÊNCIA TERRITORIAL</small></div></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav"><button className={view === 'inicio' ? 'active' : ''} onClick={() => { setView('inicio'); setMobileMenu(false) }}><LayoutGrid size={19}/> Visão geral <ArrowRight size={16} className="nav-arrow"/></button><button className={view === 'explorar' ? 'active' : ''} onClick={() => { setView('explorar'); setMobileMenu(false) }}><Compass size={19}/> Explorar território <ArrowRight size={16} className="nav-arrow"/></button><button className={view === 'salvos' ? 'active' : ''} onClick={() => { setView('salvos'); setMobileMenu(false) }}><Bookmark size={19}/> Minha lista <span className="nav-count">{saved.length}</span></button></nav>
       <div className="sidebar-bottom"><div className="sidebar-card"><div className="sidebar-card-icon"><Sparkles size={17}/></div><strong>Seu caderno de campo.</strong><p>Do território à conversa: guarde o que verificou e acompanhe cada abordagem.</p></div><div className="source-note"><span className="online-dot"/> Dados abertos via OpenStreetMap</div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu size={22}/></button><div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>{view === 'inicio' ? 'Visão geral' : view === 'explorar' ? 'Explorar território' : 'Minha lista'}</strong></div><div className="top-right"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button><span className="live-pill"><span className="online-dot"/> {storageMode === 'checking' ? 'PREPARANDO LISTA' : 'LISTA NESTE NAVEGADOR'}</span><span className="avatar">CH</span></div></header>
      <main>
        {persistenceError && storageMode === 'ready' && <div className="sync-alert" role="alert">{persistenceError}<button onClick={() => setPersistenceError('')} aria-label="Fechar aviso"><X size={15}/></button></div>}
         {view === 'inicio' ? <section className="overview">
           <div className="overview-main"><div className="eyebrow"><span className="eyebrow-line"/> ATLAS / CLIENT HUNTER</div><h1>Da cidade<br/><em>à sua lista.</em></h1><p>Escolha o território, confira os negócios no mapa e guarde os contatos que merecem uma abordagem da Binary Labs.</p><button onClick={() => setView('explorar')}>Abrir exploração <ArrowRight size={18}/></button><div className="overview-context"><span>ÁREA DE PARTIDA</span><strong>{location}</strong><small>Defina outro lugar na exploração</small></div></div>
           <div className="overview-graphic atlas-hero-visual"><img className="atlas-hero-image" src="/atlas-city.webp" alt="Ilustração editorial de uma cidade brasileira vista de cima"/><AtlasMotion/><span className="atlas-coordinate">ATLAS 01 / TERRITÓRIO</span><span className="atlas-status">Pesquisa territorial</span><span className="atlas-hero-caption">Uma visão de cidade para começar. Os locais reais aparecem no mapa após a busca.<small>Ilustração editorial · geografia fictícia</small></span></div>
           <div className="overview-actions"><button onClick={() => setView('explorar')}><Compass size={23}/><strong>Explorar território</strong><span>Escolha cidade, segmento e raio no mapa.</span><ArrowRight size={18}/></button><button onClick={() => setView('salvos')}><Bookmark size={23}/><strong>Minha lista</strong><span>{saved.length ? `${saved.length} oportunidade${saved.length === 1 ? '' : 's'} para acompanhar.` : 'Salve locais para preparar sua abordagem.'}</span><ArrowRight size={18}/></button></div>
           <div className="overview-explain overview-metrics"><div><span>01 / BUSCA</span><strong>{searched ? leads.length : '—'}</strong><p>{searched ? 'locais na última busca desta sessão' : 'Explore uma região para ver os locais'}</p></div><div><span>02 / LISTA</span><strong>{saved.length}</strong><p>oportunidades salvas neste navegador</p></div><div><span>03 / ANDAMENTO</span><strong>{saved.filter(item => item.stage !== 'novo').length}</strong><p>contatos com etapa atualizada</p></div></div>
         </section> : view === 'explorar' ? <>
           <section className="hero compact"><div><div className="eyebrow"><span className="eyebrow-line"/> EXPLORAÇÃO / 01</div><h1>Escolha a região.<br/><em>Leia o território.</em></h1><p>Os estabelecimentos encontrados aparecem na lista e no mapa. Confira a fonte antes de abordar.</p></div><div className="explore-visual"><img src="/atlas-city.webp" alt=""/><AtlasMotion/><span>ATLAS URBANO / ILUSTRAÇÃO</span></div></section>
          <section className="search-panel"><div className="panel-title"><div><SlidersHorizontal size={19}/><strong>Configure sua busca</strong></div><span>01 / DEFINIR TERRITÓRIO</span></div><div className="search-fields"><label className="field location-field"><span>LOCALIZAÇÃO</span><div className="input-icon"><MapPin size={18}/><input value={location} onChange={e => { setLocation(e.target.value); setLocationPoint(null) }} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Cidade, bairro ou endereço"/><button className="locate-button" type="button" onClick={useMyLocation} title="Usar minha localização" aria-label="Usar minha localização"><Crosshair size={15}/> <span>Minha localização</span></button></div></label><label className="field category-field"><span>SEGMENTO</span><div className="select-wrap"><Filter size={17}/><select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option value={c.value} key={c.value}>{c.label}</option>)}</select><ChevronDown size={16}/></div></label><label className="field radius-field"><span>RAIO DE BUSCA <b>{radius} km</b></span><input type="range" min="1" max="15" value={radius} onChange={e => setRadius(Number(e.target.value))}/><div className="range-labels"><span>1 km</span><span>15 km</span></div></label><button className="search-button" onClick={() => search()} disabled={loading || !location.trim()}>{loading ? <LoaderCircle className="spin" size={19}/> : <Search size={19}/>} {loading ? 'Buscando...' : 'Explorar região'} <ArrowRight size={18}/></button></div>{error && <div className="error" role="alert">{error}</div>}</section>
          <div className="section-heading"><div><div className="eyebrow small">02 / EXPLORAR RESULTADOS</div><h2>Território em foco</h2><p>{searched ? sampledPoints !== null ? `${leads.length} locais em ${sampledPoints} pontos amostrados até ${radius} km de ${location}. A área não foi coberta por completo.` : `${leads.length} estabelecimentos encontrados em até ${radius} km de ${location}.` : 'Defina uma região e comece a descobrir oportunidades.'}</p></div><div className="heading-stat"><span>{searched ? leads.length : '—'}</span><small>LOCAIS ENCONTRADOS</small></div></div>
         </> : <section className="saved-header"><div className="eyebrow"><span className="eyebrow-line"/> CADERNO / 02</div><h1>Lista de<br/><em>abordagem.</em></h1><p>{saved.length ? `${saved.length} oportunidade${saved.length === 1 ? '' : 's'} reunida${saved.length === 1 ? '' : 's'} neste navegador. Atualize a etapa e anote o próximo passo.` : 'Guarde os negócios que quer investigar. Sua lista fica vinculada a este navegador.'}</p><button className="export-button" disabled={!saved.length} onClick={() => exportCsv(saved)}><ArrowDownToLine size={17}/> Exportar CSV</button></section>}
         {view !== 'inicio' && <section className={`results-layout ${view === 'salvos' && saved.length === 0 ? 'empty-saved' : ''}`}><div className="results-column"><div className="results-toolbar"><div><strong>{view === 'salvos' ? 'Lista de prospecção' : 'Estabelecimentos'}</strong><span className="result-count">{shown.length}</span></div><div className="toolbar-actions"><button title="Lista" className={layout === 'list' ? 'selected' : ''} onClick={() => setLayout('list')}><List size={18}/></button><button title="Grade" className={layout === 'grid' ? 'selected' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={18}/></button></div></div><div className="filters-row"><div className="quick-search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrar por nome, segmento..."/></div>{view === 'salvos' ? <select className="sort-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="all">Todas as etapas</option>{stages.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select> : <select className="sort-select" value={sort} onChange={e => setSort(e.target.value as "score" | "name")}><option value="score">Mais completos</option><option value="name">Nome A–Z</option></select>}</div>
          {shown.length ? <div className={`lead-list ${layout === 'grid' ? 'grid' : ''}`}>{shown.map((lead, index) => <button key={lead.id} className={`lead-card ${selected?.id === lead.id ? 'selected' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} onClick={() => setSelected(lead)}><LeadThumbnail lead={lead}/><div className="lead-main"><div className="lead-top"><span className="lead-category">{lead.category}</span><span className="lead-score">{score(lead)}% dados</span></div><h3>{lead.name}</h3><p><MapPin size={13}/>{lead.address}{lead.city ? ` · ${lead.city}` : ''}</p><div className="lead-meta"><span className="rating-empty"><Star size={12}/> Avaliação não disponível</span><span>{lead.phone ? <><Phone size={12}/> Telefone</> : 'Sem telefone'}</span><span>{lead.website ? <><Globe2 size={12}/> Site</> : 'Sem site'}</span></div></div><ArrowRight className="lead-arrow" size={17}/></button>)}</div> : <div className="empty-state">{view === 'salvos' ? <img className="empty-illustration" src="/atlas-notes.webp" alt="Ilustração de mapa e anotações"/> : <div><Crosshair size={30}/></div>}<h3>{view === 'salvos' ? 'Sua lista começa aqui' : searched ? 'Nenhum local nesta busca' : 'O mapa espera por você'}</h3><p>{view === 'salvos' ? 'Explore o mapa e salve estabelecimentos para acompanhar.' : searched ? 'Amplie o raio ou experimente outro segmento.' : 'Escolha uma localização e clique em “Explorar região”.'}</p>{view === 'salvos' && <button onClick={() => setView('explorar')}>Explorar território <ArrowRight size={15}/></button>}</div>}
           </div>{(view !== 'salvos' || saved.length > 0) && <div className="map-column"><div className="map-heading"><div><MapPin size={17}/><strong>VISÃO DO TERRITÓRIO</strong></div><span>OpenStreetMap</span></div><div className="map-frame"><MapContainer center={initialCenter} zoom={12} scrollWheelZoom={true} zoomControl={false} className="map"><FitSearchArea center={center} radius={radius}/><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Circle center={center} radius={radius * 1000} pathOptions={{ color: '#df7147', fillColor: '#df7147', fillOpacity: .08, weight: 1, dashArray: '5 5' }}/>{shown.map(lead => <CircleMarker key={lead.id} center={[lead.lat, lead.lon]} radius={selected?.id === lead.id ? 10 : 6} pathOptions={{ color: '#fff', weight: 2, fillColor: selected?.id === lead.id ? '#101820' : '#df7147', fillOpacity: 1 }} eventHandlers={{ click: () => setSelected(lead) }}><Tooltip>{lead.name}</Tooltip></CircleMarker>)}</MapContainer><div className="map-overlay"><Crosshair size={15}/>{searched ? `${leads.length} ${sampledPoints !== null ? 'pontos na amostra' : 'pontos mapeados'}` : 'Aguardando busca'}</div></div><div className="map-footer"><span><span className="legend-dot"/> Estabelecimentos</span><span><span className="legend-ring"/> Área de busca</span></div></div>}</section>}
        <footer>CLIENT HUNTER <span>© 2026 · Inteligência territorial para novos negócios</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Dados © OpenStreetMap <ExternalLink size={12}/></a></footer>
      </main>
    </div>
    {(storageMode === 'checking' || storageMode === 'error') && <div className="access-backdrop"><div className="access-card" role="dialog" aria-modal="true" aria-labelledby="access-title"><div className="access-icon"><Crosshair size={27}/></div><span className="access-eyebrow">CLIENT HUNTER / WORKSPACE</span><h2 id="access-title">{storageMode === 'checking' ? 'Preparando sua lista.' : 'Conexão indisponível.'}</h2><p>{storageMode === 'checking' ? 'Criando sua lista neste navegador e carregando as oportunidades salvas.' : 'Não foi possível abrir sua lista. Confira a conexão e tente novamente.'}</p>{storageMode === 'error' && <button className="access-retry" onClick={() => window.location.reload()}>Tentar novamente</button>}{persistenceError && <div className="access-error" role="alert">{persistenceError}</div>}</div></div>}
    {selected && <><div className="drawer-scrim" onClick={() => setSelected(null)}/><aside className="detail-drawer"><div className="drawer-head"><span>FICHA DO ESTABELECIMENTO</span><button onClick={() => setSelected(null)} aria-label="Fechar"><X size={21}/></button></div><div className="drawer-body"><span className="lead-category">{selected.category}</span><h2>{selected.name}</h2><p className="drawer-address"><MapPin size={17}/>{selected.address}{selected.city ? ` · ${selected.city}` : ''}</p><div className="data-score"><div><strong>{score(selected)}%</strong><span>COMPLETUDE DOS DADOS</span></div><p>Índice baseado nos campos públicos disponíveis. Não representa visualizações, faturamento ou intenção de compra.</p></div><div className="detail-section"><h4>CONTATOS E PRESENÇA</h4><div className="detail-row"><Phone size={17}/><span>Telefone</span>{selected.phone ? <a href={`tel:${selected.phone}`}>{selected.phone}</a> : <em>Não informado</em>}</div><div className="detail-row"><Globe2 size={17}/><span>Website</span>{selected.website ? <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer">Abrir site <ExternalLink size={13}/></a> : <em>Não informado</em>}</div><div className="detail-row"><Compass size={17}/><span>Horário</span><em>{selected.openingHours || 'Não informado'}</em></div></div><div className="detail-section"><h4>VERIFICAR E PESQUISAR</h4><p className="detail-hint">Confira avaliações e movimento diretamente no Google Maps antes de priorizar a abordagem.</p><a className="external-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.name} ${selected.address} ${selected.city}`)}`} target="_blank" rel="noreferrer">Abrir no Google Maps <ExternalLink size={16}/></a><a className="external-link secondary" href={selected.osmUrl} target="_blank" rel="noreferrer">Ver fonte no OpenStreetMap <ExternalLink size={16}/></a></div>{activeSaved && <div className="detail-section"><h4>ACOMPANHAMENTO</h4><label className="drawer-label">Etapa<select value={activeSaved.stage} onChange={e => updateSaved(selected.id, { stage: e.target.value as SavedLead['stage'], note: noteDraft })} disabled={saving}>{stages.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label><label className="drawer-label">Observações<textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} disabled={saving} placeholder="Anote o contexto para sua abordagem..." rows={4}/></label><button className="save-note-button" disabled={saving || noteDraft === activeSaved.note} onClick={() => updateSaved(selected.id, { stage: activeSaved.stage, note: noteDraft })}>Salvar observação</button></div>}</div><div className="drawer-footer"><button className={activeSaved ? 'saved-button' : 'save-button'} onClick={() => toggleSave(selected)} disabled={saving || storageMode === 'checking'}>{activeSaved ? <Check size={18}/> : <Bookmark size={18}/>} {activeSaved ? 'Salvo na minha lista' : 'Salvar oportunidade'}</button></div></aside></>}
  </div>
}







