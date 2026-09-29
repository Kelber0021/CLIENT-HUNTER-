import { useEffect, useRef, useState } from 'react'
import './google-places-map.css'

export type GoogleMapPlace = {
  id: string
  name: string
  lat: number
  lon: number
  googleMapsUrl?: string | null
}

type LatLng = { lat: number; lng: number }
type MapObject = { setMap: (map: unknown | null) => void }
type CircleObject = MapObject & { getBounds: () => unknown }
type MapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => {
    fitBounds: (bounds: unknown, padding?: number) => void
  }
  Circle: new (options: Record<string, unknown>) => CircleObject
  Marker: new (options: Record<string, unknown>) => MapObject & {
    addListener: (event: string, callback: () => void) => void
  }
  event: { clearInstanceListeners: (instance: unknown) => void }
}

declare global {
  interface Window {
    google?: { maps: MapsApi }
  }
}

let mapsLoader: Promise<MapsApi> | undefined

function loadMaps(browserKey: string): Promise<MapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google.maps)
  if (!mapsLoader) {
    mapsLoader = new Promise<MapsApi>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(browserKey)}&v=weekly&loading=async`
      script.async = true
      script.onerror = () => reject(new Error('Não foi possível carregar o Google Maps.'))
      script.onload = () => {
        if (window.google?.maps) resolve(window.google.maps)
        else reject(new Error('O Google Maps não respondeu corretamente.'))
      }
      document.head.appendChild(script)
    }).catch((error: unknown) => {
      mapsLoader = undefined
      throw error
    })
  }
  return mapsLoader
}

export function GooglePlacesMap({
  places,
  center,
  radiusKm,
}: {
  places: GoogleMapPlace[]
  center: [latitude: number, longitude: number]
  radiusKm: number
}) {
  const elementRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const browserKey = (import.meta as ImportMeta & { env: { VITE_GOOGLE_MAPS_BROWSER_KEY?: string } }).env.VITE_GOOGLE_MAPS_BROWSER_KEY?.trim()

  useEffect(() => {
    if (!browserKey) {
      setError('Mapa do Google indisponível: configure a chave de navegador do Google Maps.')
      return
    }
    let cancelled = false
    const objects: MapObject[] = []
    let map: InstanceType<MapsApi['Map']> | undefined
    setError(null)

    loadMaps(browserKey).then((maps) => {
      if (cancelled || !elementRef.current) return
      const origin: LatLng = { lat: center[0], lng: center[1] }
      map = new maps.Map(elementRef.current, {
        center: origin,
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'cooperative',
      })
      const safeRadius = Number.isFinite(radiusKm) ? Math.max(1, Math.min(radiusKm, 50)) : 1
      const circle = new maps.Circle({
        map,
        center: origin,
        radius: safeRadius * 1000,
        strokeColor: '#e6774d',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: '#e6774d',
        fillOpacity: 0.09,
        clickable: false,
      })
      objects.push(circle)
      map.fitBounds(circle.getBounds(), 24)

      for (const place of places) {
        if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue
        const marker = new maps.Marker({
          map,
          position: { lat: place.lat, lng: place.lon },
          title: place.name,
        })
        if (place.googleMapsUrl) {
          marker.addListener('click', () => {
            const url = new URL(place.googleMapsUrl!, 'https://www.google.com')
            if (url.protocol === 'https:' && /(^|\.)google\.com(\.br)?$/i.test(url.hostname)) {
              window.open(url.href, '_blank', 'noopener,noreferrer')
            }
          })
        }
        objects.push(marker)
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o Google Maps.')
    })

    return () => {
      cancelled = true
      for (const object of objects) object.setMap(null)
      if (map) window.google?.maps.event.clearInstanceListeners(map)
    }
  }, [browserKey, center[0], center[1], radiusKm, places])

  return (
    <div className="google-places-map-shell">
      {error ? (
        <div className="google-places-map-error" role="status">{error}</div>
      ) : (
        <div ref={elementRef} className="google-places-map-canvas" aria-label="Mapa Google dos locais encontrados e raio da busca" />
      )}
    </div>
  )
}
