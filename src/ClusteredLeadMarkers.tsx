import { useMemo, useState } from 'react'
import { CircleMarker, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { divIcon, latLngBounds, type DivIcon } from 'leaflet'

export type MapLead = { id: string; name: string; lat: number; lon: number }

type Props<T extends MapLead> = {
  leads: T[]
  selectedId?: string
  onSelect: (lead: T) => void
  colorOf: (lead: T) => string
}

const CELL_SIZE = 64
const icons = new Map<string, DivIcon>()

/** Cluster as a small pie: the ring shows which segments are grouped in that spot. */
function clusterIcon(count: number, slices: [string, number][], selected: boolean) {
  const size = Math.round(Math.min(46, 28 + Math.log2(count) * 3))
  const key = `${count}|${selected}|${slices.map(([color, n]) => `${color}:${n}`).join(',')}`
  let icon = icons.get(key)
  if (!icon) {
    let start = 0
    const stops = slices.map(([color, n]) => { const end = start + n / count * 360; const stop = `${color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`; start = end; return stop }).join(',')
    const label = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace('.', ',')} mil` : String(count)
    icon = divIcon({
      className: `lead-cluster${selected ? ' contains-selected' : ''}`,
      html: `<span class="lead-cluster-ring" style="background:conic-gradient(${stops})"><b>${label}</b></span>`,
      iconSize: [size, size],
    })
    if (icons.size > 1500) icons.clear()
    icons.set(key, icon)
  }
  return icon
}

const pulseIcon = divIcon({ className: 'lead-selected-pulse', html: '<span></span>', iconSize: [44, 44] })

/** Groups nearby points in screen pixels, recalculating only when the map settles. */
export default function ClusteredLeadMarkers<T extends MapLead>({ leads, selectedId, onSelect, colorOf }: Props<T>) {
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

  const selected = selectedId ? leads.find(lead => lead.id === selectedId) : undefined

  return <>
    {groups.map(({ key, members }) => {
      if (members.length === 1) {
        const lead = members[0]
        const isSelected = selectedId === lead.id
        return <CircleMarker
          key={lead.id}
          center={[lead.lat, lead.lon]}
          radius={isSelected ? 10 : 6.5}
          pathOptions={{ color: '#fff', weight: isSelected ? 3 : 2, fillColor: isSelected ? '#172b34' : colorOf(lead), fillOpacity: 1 }}
          eventHandlers={{ click: () => onSelect(lead) }}
        ><Tooltip direction="top" offset={[0, -6]}>{lead.name}</Tooltip></CircleMarker>
      }

      const latitude = members.reduce((sum, lead) => sum + lead.lat, 0) / members.length
      const longitude = members.reduce((sum, lead) => sum + lead.lon, 0) / members.length
      const tally = new Map<string, number>()
      for (const lead of members) { const color = colorOf(lead); tally.set(color, (tally.get(color) || 0) + 1) }
      const slices = [...tally.entries()].sort((a, b) => b[1] - a[1])

      return <Marker
        key={key}
        position={[latitude, longitude]}
        icon={clusterIcon(members.length, slices, members.some(lead => lead.id === selectedId))}
        keyboard={false}
        eventHandlers={{ click: () => {
          const bounds = latLngBounds(members.map(lead => [lead.lat, lead.lon] as [number, number]))
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
            map.setView(bounds.getCenter(), Math.min(map.getZoom() + 2, 18), { animate: true })
          } else {
            map.fitBounds(bounds.pad(0.4), { padding: [44, 44], maxZoom: Math.min(map.getZoom() + 3, 18), animate: true })
          }
        } }}
      ><Tooltip direction="top" offset={[0, -14]}>{members.length} locais · toque para aproximar</Tooltip></Marker>
    })}
    {selected && <Marker key={`pulse-${selected.id}`} position={[selected.lat, selected.lon]} icon={pulseIcon} interactive={false} keyboard={false}/>}
  </>
}
