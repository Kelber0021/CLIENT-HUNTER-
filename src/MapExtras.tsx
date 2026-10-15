import { useEffect, useRef, useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import { Crosshair, LocateFixed } from 'lucide-react'
import { reducedMotion } from './motion'

/** Frames the search circle; after the first search the map glides there instead of jumping. */
export function FitSearchArea({ center, radius, searchId }: { center: [number, number]; radius: number; searchId: number }) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    const latDelta = radius / 111.2
    const lonDelta = radius / (111.2 * Math.cos(center[0] * Math.PI / 180))
    const bounds: [[number, number], [number, number]] = [[center[0] - latDelta, center[1] - lonDelta], [center[0] + latDelta, center[1] + lonDelta]]
    const frame = requestAnimationFrame(() => {
      map.invalidateSize()
      if (first.current || reducedMotion()) map.fitBounds(bounds, { padding: [25, 25], maxZoom: 14, animate: false })
      else map.flyToBounds(bounds, { padding: [25, 25], maxZoom: 14, duration: .9 })
      first.current = false
    })
    return () => cancelAnimationFrame(frame)
    // searchId re-frames the same area when the user searches it again.
  }, [center, radius, map, searchId])
  return null
}

/** Keeps the chosen place visible without yanking the whole map around. */
export function RevealSelected({ point }: { point?: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    if (!point) return
    map.panInside(point, { padding: [70, 70], animate: !reducedMotion() })
  }, [point?.[0], point?.[1], map])
  return null
}

/** Offers a new search where the user has panned to, once the view has clearly left the searched area. */
export function SearchHere({ center, radius, disabled, onSearch }: { center: [number, number]; radius: number; disabled: boolean; onSearch: (point: [number, number]) => void }) {
  const map = useMap()
  const [moved, setMoved] = useState<[number, number] | null>(null)
  useEffect(() => setMoved(null), [center[0], center[1]])
  useMapEvents({
    moveend: () => {
      const view = map.getCenter()
      const distance = map.distance(view, center) / 1000
      setMoved(distance > Math.max(.8, radius * .45) ? [view.lat, view.lng] : null)
    },
  })
  if (!moved || disabled) return null
  return <button type="button" className="search-here" onClick={() => { onSearch(moved); setMoved(null) }}><LocateFixed size={15}/> Buscar nesta área</button>
}

export function MapRadar({ found, status, progress }: { found: number; status: string; progress: number | null }) {
  return <div className="map-radar" role="status" aria-live="polite">
    <span className="radar-disc" aria-hidden="true"><span className="radar-sweep"/><span className="radar-ring"/><span className="radar-ring r2"/></span>
    <div className="radar-card">
      <Crosshair size={15}/>
      <div><strong>{found ? `${new Intl.NumberFormat('pt-BR').format(found)} locais até agora` : 'Varrendo o território'}</strong><span>{status}</span></div>
      {progress !== null && <i style={{ transform: `scaleX(${Math.max(.04, progress)})` }} aria-hidden="true"/>}
    </div>
  </div>
}
