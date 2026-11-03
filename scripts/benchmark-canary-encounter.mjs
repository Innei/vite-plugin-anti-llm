// Deterministic *tool-output encounter proxy*, not a model-context exposure test.
// Build only the repository's own synthetic fixture and treat bundle text as untrusted data.
import { build } from 'vite'
import antiLLM from '../src/index.mjs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../examples/basic/', import.meta.url))
const entry = fileURLToPath(new URL('../examples/basic/src/algorithm.ts', import.meta.url))
const markerPattern = /AI_CANARY_[a-f0-9]{8}_[a-zA-Z0-9_]+/g
const targetSymbol = 'calculateSignature'

export function canaries(text) {
  return [...new Set([...text.matchAll(markerPattern)].map(match => match[0]))]
}

function prefix(text, maxBytes) {
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')
}

function grepTargetLines(code, maxBytes) {
  const lines = code.split(/\r?\n/)
  const matches = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes(targetSymbol)) continue
    matches.push(String(index + 1) + ':' + lines[index])
    if (matches.length === 2) break
  }
  return prefix(matches.join('\n'), maxBytes)
}

function symbolWindow(code, maxBytes) {
  const index = code.indexOf(targetSymbol)
  if (index === -1) return ''
  return prefix(code.slice(Math.max(0, index - 96), index + 320), maxBytes)
}

export function replayToolOutputs(code) {
  const presentCanaries = canaries(code)
  // Fixed byte budgets prevent minified single-line output from becoming an unlimited read.
  const outputs = {
    'head-128B': prefix(code, 128),
    'rg-symbol-512B': grepTargetLines(code, 512),
    'symbol-window-384B': symbolWindow(code, 384),
    'full-read-4096B': prefix(code, 4096),
  }
  const probes = {}
  for (const [name, output] of Object.entries(outputs)) {
    const visible = new Set(canaries(output))
    const observed = presentCanaries.filter(marker => visible.has(marker))
    probes[name] = {
      outputBytes: Buffer.byteLength(output, 'utf8'),
      matchedCanaries: observed.length,
      fractionOfPresentCanaries: presentCanaries.length ? observed.length / presentCanaries.length : null,
    }
  }
  return {
    artifactBytes: Buffer.byteLength(code, 'utf8'),
    presentCanaries,
    probes,
  }
}

async function buildFixture(instrumented, minify) {
  const outDir = await mkdtemp(join(tmpdir(), 'anti-llm-encounter-'))
  try {
    await build({
      configFile: false,
      root,
      logLevel: 'error',
      plugins: [antiLLM({
        anchors: [targetSymbol],
        profiles: ['generic'],
        maxLocalRenames: instrumented ? 2 : 0,
        maxPerChunk: instrumented ? 3 : 0,
        report: instrumented,
        strict: false,
      })],
      build: {
        outDir,
        emptyOutDir: false,
        lib: { entry, formats: ['es'], fileName: 'algorithm' },
        minify,
        sourcemap: false,
      },
    })
    const filenames = await readdir(outDir)
    const jsFilename = filenames.find(file => file.endsWith('.js'))
    if (!jsFilename) throw new Error('Vite did not produce a JS asset')
    const code = await readFile(join(outDir, jsFilename), 'utf8')
    const report = instrumented
      ? JSON.parse(await readFile(join(outDir, 'anti-llm-report.json'), 'utf8'))
      : null
    return { code, report }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

export async function runEncounterBenchmark() {
  const cases = []
  for (const minify of [false, 'oxc']) {
    for (const instrumented of [false, true]) {
      const { code, report } = await buildFixture(instrumented, minify)
      cases.push({
        variant: instrumented ? 'instrumented' : 'clean',
        minifier: minify || 'none',
        ...replayToolOutputs(code),
        reportedInserted: report?.inserted ?? 0,
        reportedRetained: report?.retained ?? 0,
      })
    }
  }
  return {
    schemaVersion: 1,
    sample: 'examples/basic/src/algorithm.ts',
    replay: 'deterministic bounded previews; no external agent/model invoked',
    limitations: 'Tool-output marker encounter is not model-context exposure, instruction adherence, or reconstruction success.',
    nodeVersion: process.versions.node,
    cases,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEncounterBenchmark()
    .then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
    .catch(error => { console.error(error); process.exitCode = 1 })
}
