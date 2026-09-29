import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSample } from './osm-sample.mjs'
import { handleGooglePlaces, googlePlacesStatus } from './google-places.mjs'
const api = { name: 'osm-sample-api', configureServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void } }) { server.middlewares.use('/api/osm-sample', handleSample as never) }, configurePreviewServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void } }) { server.middlewares.use('/api/osm-sample', handleSample as never) } }
const placesApi = { name: 'google-places-api', configureServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void } }) { server.middlewares.use('/api/google-places/status', googlePlacesStatus as never); server.middlewares.use('/api/google-places', handleGooglePlaces as never) }, configurePreviewServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void } }) { server.middlewares.use('/api/google-places/status', googlePlacesStatus as never); server.middlewares.use('/api/google-places', handleGooglePlaces as never) } }
export default defineConfig({ plugins: [react(), api, placesApi] })
