import { useMemo, useState } from 'react'
import { CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { latLngBounds } from 'leaflet'

export type MapLead = { id: string; name: string; lat: number; lon: number }

type Props<T extends MapLead> = {
  leads: T[]
  selectedId?: string
  onSelect: (lead: T) => void
}

const CELL_SIZE = 58

/** Groups nearby points in screen pixels, recalculating only when the map settles. */
export default function ClusteredLeadMarkers<T extends MapLead>({ leads, selectedId, onSelect }: Props<T>) {
  const map = useMap()
  const [revision, setRevision] = useState(0)

  useMapEvents({
    zoomend: () => setRevision(value => value + 1),
    moveend: () => setRevision(value => value + 1),
    resize: () => setRevision(value => value + 1),
  })

  const groups = useMemo(() => {
    const zoom = map.getZoom()
    const cells = new Map<string, T[]>()
    for (const lead of leads) {
      if (!Number.isFinite(lead.lat) || !Number.isFinite(lead.lon)) continue
      const point = map.project([lead.lat, lead.lon], zoom)
      const key = `${Math.floor(point.x / CELL_SIZE)}:${Math.floor(point.y / CELL_SIZE)}`
      const cell = cells.get(key)
      if (cell) cell.push(lead)
      else cells.set(key, [lead])
    }
    return [...cells.entries()].map(([key, members]) => ({ key, members }))
    // revision signals a completed map movement; project() depends on the map zoom.
  }, [map, leads, revision])

  return <>
    {groups.map(({ key, members }) => {
      if (members.length === 1) {
        const lead = members[0]
        const selected = selectedId === lead.id
        return <CircleMarker
          key={lead.id}
          center={[lead.lat, lead.lon]}
          radius={selected ? 10 : 6}
          pathOptions={{ color: '#fff', weight: selected ? 3 : 2, fillColor: selected ? '#101820' : '#df7147', fillOpacity: 1 }}
          eventHandlers={{ click: () => onSelect(lead) }}
        ><Tooltip>{lead.name}</Tooltip></CircleMarker>
      }

      const latitude = members.reduce((sum, lead) => sum + lead.lat, 0) / members.length
      const longitude = members.reduce((sum, lead) => sum + lead.lon, 0) / members.length
      const containsSelected = members.some(lead => lead.id === selectedId)
      const radius = Math.min(25, 13 + Math.log2(members.length) * 2)

      return <CircleMarker
        key={key}
        center={[latitude, longitude]}
        radius={radius}
        pathOptions={{ color: '#fff', weight: 3, fillColor: containsSelected ? '#101820' : '#df7147', fillOpacity: 0.95 }}
        eventHandlers={{ click: () => {
          const bounds = latLngBounds(members.map(lead => [lead.lat, lead.lon] as [number, number]))
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
            map.setView(bounds.getCenter(), Math.min(map.getZoom() + 2, 18), { animate: true })
          } else {
            map.fitBounds(bounds.pad(0.4), { padding: [44, 44], maxZoom: Math.min(map.getZoom() + 3, 18), animate: true })
          }
        } }}
      ><Tooltip permanent direction="center" opacity={1} className="lead-cluster-count">{members.length}</Tooltip></CircleMarker>
    })}
  </>
}
