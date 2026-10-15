import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSample } from './osm-sample.mjs'
import { handleGooglePlaces, googlePlacesStatus } from './google-places.mjs'
import { handlePlaces } from './osm-places.mjs'
import { handleGeocode } from './geocode.mjs'

// Same API as server.mjs, without a database (the tile cache stays in memory).
// Connect strips the mount path from req.url; the handlers only read the query string.
// More specific paths first: '/api/google-places' would also match '/api/google-places/status'.
const routes: [string, (req: never, res: never) => unknown][] = [
  ['/api/places', (req, res) => handlePlaces(req, res)],
  ['/api/geocode', handleGeocode as never],
  ['/api/osm-sample', handleSample as never],
  ['/api/google-places/status', googlePlacesStatus as never],
  ['/api/google-places', handleGooglePlaces as never],
]
const mount = (server: { middlewares: { use: (path: string, handler: never) => void } }) => { for (const [path, handler] of routes) server.middlewares.use(path, handler as never) }
const api = { name: 'client-hunter-api', configureServer: mount as never, configurePreviewServer: mount as never }

export default defineConfig({ plugins: [react(), api] })
