import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { ArrowDownToLine, ArrowRight, Bookmark, Check, ChevronDown, Compass, Crosshair, ExternalLink, Filter, Globe2, LayoutGrid, List, LoaderCircle, MapPin, Menu, Phone, Search, SlidersHorizontal, Sparkles, Target, X, Sun, Moon, Star, Building2 } from 'lucide-react'
import { categories, exportCsv, findLeads, geocode, score, photoUrl, type Lead, type SavedLead } from './data'

const initialCenter: [number, number] = [-3.7319, -38.5267]
const stages: SavedLead['stage'][] = ['novo', 'qualificado', 'contatado', 'negociando', 'ganho']
function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) { const map = useMap(); useEffect(() => { map.flyTo(center, zoom, { duration: 1.2 }) }, [center, zoom, map]); return null }
function loadSaved(): SavedLead[] { try { return JSON.parse(localStorage.getItem('client-hunter-leads') || '[]') } catch { return [] } }

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
  const [saved, setSaved] = useState<SavedLead[]>(loadSaved)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<'score' | 'name'>('score')
  const [layout, setLayout] = useState<'list' | 'grid'>('list')
  const [stageFilter, setStageFilter] = useState('all')
  useEffect(() => { localStorage.setItem('client-hunter-leads', JSON.stringify(saved)) }, [saved])

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
      setLeads(result); setSearched(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao buscar locais.') }
    finally { setLoading(false) }
  }
  function toggleSave(lead: Lead) { setSaved(prev => prev.some(s => s.lead.id === lead.id) ? prev.filter(s => s.lead.id !== lead.id) : [{ lead, stage: 'novo', note: '', savedAt: Date.now() }, ...prev]) }
  function updateSaved(id: string, patch: Partial<SavedLead>) { setSaved(prev => prev.map(s => s.lead.id === id ? { ...s, ...patch } : s)) }
  const shown = useMemo(() => {
    const list = view === 'salvos' ? saved.filter(s => stageFilter === 'all' || s.stage === stageFilter).map(s => s.lead) : leads
    return list.filter(l => `${l.name} ${l.category} ${l.address}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).sort((a, b) => sort === 'score' ? score(b) - score(a) : a.name.localeCompare(b.name, 'pt-BR'))
  }, [view, saved, stageFilter, leads, query, sort])
  const activeSaved = selected && saved.find(s => s.lead.id === selected.id)

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Crosshair size={24} strokeWidth={2.5}/></div><div><strong>CLIENT<span>HUNTER</span></strong><small>INTELIGÊNCIA TERRITORIAL</small></div></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav"><button className={view === 'inicio' ? 'active' : ''} onClick={() => { setView('inicio'); setMobileMenu(false) }}><LayoutGrid size={19}/> Visão geral <ArrowRight size={16} className="nav-arrow"/></button><button className={view === 'explorar' ? 'active' : ''} onClick={() => { setView('explorar'); setMobileMenu(false) }}><Compass size={19}/> Explorar território <ArrowRight size={16} className="nav-arrow"/></button><button className={view === 'salvos' ? 'active' : ''} onClick={() => { setView('salvos'); setMobileMenu(false) }}><Bookmark size={19}/> Minha lista <span className="nav-count">{saved.length}</span></button></nav>
      <div className="sidebar-bottom"><div className="sidebar-card"><div className="sidebar-card-icon"><Sparkles size={17}/></div><strong>Encontre o próximo cliente.</strong><p>Explore negócios reais, descubra sinais de presença digital e organize sua abordagem.</p></div><div className="source-note"><span className="online-dot"/> Dados abertos via OpenStreetMap</div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu size={22}/></button><div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>{view === 'inicio' ? 'Visão geral' : view === 'explorar' ? 'Explorar território' : 'Minha lista'}</strong></div><div className="top-right"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button><span className="live-pill"><span className="online-dot"/> DADOS AO VIVO</span><span className="avatar">CH</span></div></header>
      <main>
        {view === 'inicio' ? <section className="overview"><div className="overview-main"><div className="eyebrow"><span className="eyebrow-line"/> RADAR DE OPORTUNIDADES</div><h1>Encontre clientes<br/><em>onde eles estão.</em></h1><p>Explore negócios reais por território, descubra sinais úteis e transforme sua pesquisa em uma lista de prospecção organizada.</p><button onClick={() => setView('explorar')}>Começar a explorar <ArrowRight size={18}/></button></div><div className="overview-graphic"><div className="overview-circle"><Target size={49}/></div><span>INTELIGÊNCIA TERRITORIAL</span></div><div className="overview-actions"><button onClick={() => setView('explorar')}><Compass size={23}/><strong>Explorar território</strong><span>Busque por cidade, bairro, segmento e raio.</span><ArrowRight size={18}/></button><button onClick={() => setView('salvos')}><Bookmark size={23}/><strong>Minha lista</strong><span>Acompanhe contatos e exporte oportunidades.</span><ArrowRight size={18}/></button></div><div className="overview-explain"><div><span>01</span><strong>Defina a área</strong><p>Escolha a localização, o segmento e a distância.</p></div><div><span>02</span><strong>Analise os locais</strong><p>Confira contatos, website e localização no mapa.</p></div><div><span>03</span><strong>Organize a abordagem</strong><p>Salve, anote e acompanhe cada oportunidade.</p></div></div></section> : view === 'explorar' ? <>
          <section className="hero compact"><div><div className="eyebrow"><span className="eyebrow-line"/> RADAR DE OPORTUNIDADES</div><h1>Oportunidades estão<br/><em>ao seu redor.</em></h1><p>Mapeie negócios em qualquer região, identifique sinais de presença digital e transforme lugares em conversas.</p></div><div className="hero-orbit"><div className="orbit outer"/><div className="orbit inner"/><div className="orbit-core"><Target size={32}/></div><span className="orbit-dot one"/><span className="orbit-dot two"/><span className="orbit-dot three"/></div></section>
          <section className="search-panel"><div className="panel-title"><div><SlidersHorizontal size={19}/><strong>Configure sua busca</strong></div><span>01 / DEFINIR TERRITÓRIO</span></div><div className="search-fields"><label className="field location-field"><span>LOCALIZAÇÃO</span><div className="input-icon"><MapPin size={18}/><input value={location} onChange={e => { setLocation(e.target.value); setLocationPoint(null) }} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Cidade, bairro ou endereço"/><button className="locate-button" type="button" onClick={useMyLocation} title="Usar minha localização" aria-label="Usar minha localização"><Crosshair size={17}/></button></div></label><label className="field category-field"><span>SEGMENTO</span><div className="select-wrap"><Filter size={17}/><select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option value={c.value} key={c.value}>{c.label}</option>)}</select><ChevronDown size={16}/></div></label><label className="field radius-field"><span>RAIO DE BUSCA <b>{radius} km</b></span><input type="range" min="1" max="15" value={radius} onChange={e => setRadius(Number(e.target.value))}/><div className="range-labels"><span>1 km</span><span>15 km</span></div></label><button className="search-button" onClick={() => search()} disabled={loading || !location.trim()}>{loading ? <LoaderCircle className="spin" size={19}/> : <Search size={19}/>} {loading ? 'Buscando...' : 'Explorar região'} <ArrowRight size={18}/></button></div>{error && <div className="error" role="alert">{error}</div>}</section>
          <div className="section-heading"><div><div className="eyebrow small">02 / EXPLORAR RESULTADOS</div><h2>Território em foco</h2><p>{searched ? leads[0]?.tags['client_hunter:sample'] ? `${leads.length} locais em uma amostra central de ${location}. A fonte principal está indisponível; a área inteira não foi coberta.` : `${leads.length} estabelecimentos encontrados em até ${radius} km de ${location}.` : 'Defina uma região e comece a descobrir oportunidades.'}</p></div><div className="heading-stat"><span>{searched ? leads.length : '—'}</span><small>LOCAIS ENCONTRADOS</small></div></div>
        </> : <section className="saved-header"><div className="eyebrow"><span className="eyebrow-line"/> SEU PIPELINE</div><h1>Seus próximos<br/><em>grandes clientes.</em></h1><p>Uma lista viva para acompanhar cada oportunidade, do primeiro olhar à negociação.</p><button className="export-button" disabled={!saved.length} onClick={() => exportCsv(saved)}><ArrowDownToLine size={17}/> Exportar CSV</button></section>}
        {view !== 'inicio' && <section className="results-layout"><div className="results-column"><div className="results-toolbar"><div><strong>{view === 'salvos' ? 'Lista de prospecção' : 'Estabelecimentos'}</strong><span className="result-count">{shown.length}</span></div><div className="toolbar-actions"><button title="Lista" className={layout === 'list' ? 'selected' : ''} onClick={() => setLayout('list')}><List size={18}/></button><button title="Grade" className={layout === 'grid' ? 'selected' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={18}/></button></div></div><div className="filters-row"><div className="quick-search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrar por nome, segmento..."/></div>{view === 'salvos' ? <select className="sort-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="all">Todas as etapas</option>{stages.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select> : <select className="sort-select" value={sort} onChange={e => setSort(e.target.value as "score" | "name")}><option value="score">Mais completos</option><option value="name">Nome A–Z</option></select>}</div>
          {shown.length ? <div className={`lead-list ${layout === 'grid' ? 'grid' : ''}`}>{shown.map((lead) => <button key={lead.id} className={`lead-card ${selected?.id === lead.id ? 'selected' : ''}`} onClick={() => setSelected(lead)}><div className="lead-thumb">{photoUrl(lead) ? <img src={photoUrl(lead)} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} /> : <Building2 size={22}/>}</div><div className="lead-main"><div className="lead-top"><span className="lead-category">{lead.category}</span><span className="lead-score">{score(lead)}% dados</span></div><h3>{lead.name}</h3><p><MapPin size={13}/>{lead.address}{lead.city ? ` · ${lead.city}` : ''}</p><div className="lead-meta"><span className="rating-empty"><Star size={12}/> Avaliação não disponível</span><span>{lead.phone ? <><Phone size={12}/> Telefone</> : 'Sem telefone'}</span><span>{lead.website ? <><Globe2 size={12}/> Site</> : 'Sem site'}</span></div></div><ArrowRight className="lead-arrow" size={17}/></button>)}</div> : <div className="empty-state"><div><Crosshair size={30}/></div><h3>{view === 'salvos' ? 'Sua lista começa aqui' : searched ? 'Nenhum local nesta busca' : 'O mapa espera por você'}</h3><p>{view === 'salvos' ? 'Explore o mapa e salve estabelecimentos para acompanhar.' : searched ? 'Amplie o raio ou experimente outro segmento.' : 'Escolha uma localização e clique em “Explorar região”.'}</p>{view === 'salvos' && <button onClick={() => setView('explorar')}>Explorar território <ArrowRight size={15}/></button>}</div>}
          </div><div className="map-column"><div className="map-heading"><div><MapPin size={17}/><strong>VISÃO DO TERRITÓRIO</strong></div><span>OpenStreetMap</span></div><div className="map-frame"><MapContainer center={initialCenter} zoom={12} scrollWheelZoom={true} zoomControl={false} className="map"><FlyTo center={center} zoom={radius < 4 ? 13 : radius < 9 ? 12 : 11}/><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Circle center={center} radius={leads.some(l => l.tags['client_hunter:sample']) ? 450 : radius * 1000} pathOptions={{ color: '#df7147', fillColor: '#df7147', fillOpacity: .08, weight: 1, dashArray: '5 5' }}/>{shown.map(lead => <CircleMarker key={lead.id} center={[lead.lat, lead.lon]} radius={selected?.id === lead.id ? 10 : 6} pathOptions={{ color: '#fff', weight: 2, fillColor: selected?.id === lead.id ? '#101820' : '#df7147', fillOpacity: 1 }} eventHandlers={{ click: () => setSelected(lead) }}><Tooltip>{lead.name}</Tooltip></CircleMarker>)}</MapContainer><div className="map-overlay"><Crosshair size={15}/>{searched ? `${leads.length} ${leads.some(l => l.tags['client_hunter:sample']) ? 'pontos na amostra' : 'pontos mapeados'}` : 'Aguardando busca'}</div></div><div className="map-footer"><span><span className="legend-dot"/> Estabelecimentos</span><span><span className="legend-ring"/> Área de busca</span></div></div></section>}
        <footer>CLIENT HUNTER <span>© 2026 · Inteligência territorial para novos negócios</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Dados © OpenStreetMap <ExternalLink size={12}/></a></footer>
      </main>
    </div>
    {selected && <><div className="drawer-scrim" onClick={() => setSelected(null)}/><aside className="detail-drawer"><div className="drawer-head"><span>FICHA DO ESTABELECIMENTO</span><button onClick={() => setSelected(null)} aria-label="Fechar"><X size={21}/></button></div><div className="drawer-body"><span className="lead-category">{selected.category}</span><h2>{selected.name}</h2><p className="drawer-address"><MapPin size={17}/>{selected.address}{selected.city ? ` · ${selected.city}` : ''}</p><div className="data-score"><div><strong>{score(selected)}%</strong><span>COMPLETUDE DOS DADOS</span></div><p>Índice baseado nos campos públicos disponíveis. Não representa visualizações, faturamento ou intenção de compra.</p></div><div className="detail-section"><h4>CONTATOS E PRESENÇA</h4><div className="detail-row"><Phone size={17}/><span>Telefone</span>{selected.phone ? <a href={`tel:${selected.phone}`}>{selected.phone}</a> : <em>Não informado</em>}</div><div className="detail-row"><Globe2 size={17}/><span>Website</span>{selected.website ? <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer">Abrir site <ExternalLink size={13}/></a> : <em>Não informado</em>}</div><div className="detail-row"><Compass size={17}/><span>Horário</span><em>{selected.openingHours || 'Não informado'}</em></div></div><div className="detail-section"><h4>VERIFICAR E PESQUISAR</h4><p className="detail-hint">Confira avaliações e movimento diretamente no Google Maps antes de priorizar a abordagem.</p><a className="external-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.name} ${selected.address} ${selected.city}`)}`} target="_blank" rel="noreferrer">Abrir no Google Maps <ExternalLink size={16}/></a><a className="external-link secondary" href={selected.osmUrl} target="_blank" rel="noreferrer">Ver fonte no OpenStreetMap <ExternalLink size={16}/></a></div>{activeSaved && <div className="detail-section"><h4>ACOMPANHAMENTO</h4><label className="drawer-label">Etapa<select value={activeSaved.stage} onChange={e => updateSaved(selected.id, { stage: e.target.value as SavedLead['stage'] })}>{stages.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label><label className="drawer-label">Observações<textarea value={activeSaved.note} onChange={e => updateSaved(selected.id, { note: e.target.value })} placeholder="Anote o contexto para sua abordagem..." rows={4}/></label></div>}</div><div className="drawer-footer"><button className={activeSaved ? 'saved-button' : 'save-button'} onClick={() => toggleSave(selected)}>{activeSaved ? <Check size={18}/> : <Bookmark size={18}/>} {activeSaved ? 'Salvo na minha lista' : 'Salvar oportunidade'}</button></div></aside></>}
  </div>
}




