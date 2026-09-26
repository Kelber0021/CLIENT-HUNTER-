import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSample } from './osm-sample.mjs'
const api = { name: 'osm-sample-api', configureServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void } }) { server.middlewares.use('/api/osm-sample', handleSample as never) }, configurePreviewServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void } }) { server.middlewares.use('/api/osm-sample', handleSample as never) } }
export default defineConfig({ plugins: [react(), api] })
