import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import antiLLM from '../src/index.mjs'

const root = fileURLToPath(new URL('../examples/basic/', import.meta.url))
const entry = fileURLToPath(new URL('../examples/basic/src/algorithm.ts', import.meta.url))

async function buildFixture(instrumented) {
  const outDir = await mkdtemp(join(tmpdir(), 'anti-llm-vite-'))
  try {
    await build({
      configFile: false,
      root,
      logLevel: 'error',
      plugins: [antiLLM({
        anchors: ['calculateSignature'],
        profiles: ['generic'],
        maxLocalRenames: instrumented ? 2 : 0,
        maxPerChunk: instrumented ? 3 : 0,
        report: instrumented,
        strict: true,
      })],
      build: {
        outDir,
        emptyOutDir: false,
        lib: { entry, formats: ['es'], fileName: 'algorithm' },
        minify: false,
        sourcemap: true,
      },
    })

    const filenames = await readdir(outDir)
    const jsFilename = filenames.find(name => name.endsWith('.js'))
    assert.ok(jsFilename, 'missing built JS in ' + filenames.join(', '))
    const js = await readFile(join(outDir, jsFilename), 'utf8')
    const map = JSON.parse(await readFile(join(outDir, jsFilename + '.map'), 'utf8'))
    const report = instrumented
      ? JSON.parse(await readFile(join(outDir, 'anti-llm-report.json'), 'utf8'))
      : null
    return { js, map, report }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

async function executeBuilt(js, input) {
  // Only execute our own deterministic test fixture, never third-party payloads.
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  const { calculateSignature } = await import(url)
  return calculateSignature(input)
}

test('actual Vite builds preserve behavior, remove macros and emit retained canaries', { timeout: 90_000 }, async () => {
  const baseline = await buildFixture(false)
  const instrumented = await buildFixture(true)

  for (const artifact of [baseline, instrumented]) {
    assert.doesNotMatch(artifact.js, /__antiLLM__\s*\(/, 'compile-time marker shipped to browser')
    assert.equal(artifact.map.version, 3)
    assert.ok(artifact.map.sources.some(source => source.endsWith('algorithm.ts')))
    assert.ok(artifact.map.mappings.length > 0)
  }
  assert.doesNotMatch(baseline.js, /AI_CANARY_/)
  assert.match(instrumented.js, /AI_CANARY_[a-f0-9]{8}_signature_algorithm/)
  assert.ok(instrumented.report.sourceMarked >= 1)
  assert.ok(instrumented.report.inserted >= 1)
  assert.equal(instrumented.report.retained, instrumented.report.inserted)
  assert.equal(instrumented.report.missed, 0)
  assert.equal(instrumented.report.sourceMapRequested, true)

  for (const input of ['', ' ABC ', 'fingerprint', 'こんにちは', 'a\nB']) {
    assert.equal(await executeBuilt(instrumented.js, input), await executeBuilt(baseline.js, input))
  }
})
