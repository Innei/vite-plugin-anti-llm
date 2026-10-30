import { defineConfig } from 'vite'
import antiLLM from '../../src/index.mjs'

export default defineConfig({
  build: { lib: { entry: 'src/algorithm.ts', formats: ['es'], fileName: 'algorithm' } },
  plugins: [antiLLM({
    anchors: ['signature', 'algorithm'],
    profiles: ['generic', 'openai', 'anthropic', 'google'],
    maxLocalRenames: 2,
    report: true,
    strict: true,
  })],
})

