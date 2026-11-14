import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import antiLLM from '../src/index.mjs'
import { replayCanaryProbes } from '../src/inspect.mjs'

const root = fileURLToPath(new URL('../examples/basic/', import.meta.url))
const entry = fileURLToPath(new URL('../examples/basic/src/algorithm.ts', import.meta.url))

async function fixture(mode) {
  const result = await build({
    root, configFile: false, logLevel: 'silent',
    plugins: [antiLLM({ mode, strict: true, report: true })],
    build: { write: false, minify: 'oxc', lib: { entry, formats: ['es'], fileName: () => 'fixture.mjs' } },
  })
  const output = (Array.isArray(result) ? result : [result]).flatMap(result => result.output)
  const code = output.find(item => item.type === 'chunk').code
  const report = output.find(item => item.fileName === 'anti-llm-report.json')
  return { code, report: report && JSON.parse(report.source), bytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).byteLength }
}

export async function runLocalBenchmark() {
  const off = await fixture('off')
  const on = await fixture('canary')
  const execute = code => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const baseline = await execute(off.code)
  const instrumented = await execute(on.code)
  for (const input of ['', ' ABC ', 'sample', 'a\nb']) {
    assert.equal(instrumented.calculateSignature(input), baseline.calculateSignature(input))
  }
  return {
    schemaVersion: 1,
    scope: 'Own synthetic fixture, deterministic local build and extraction; no model service invoked.',
    behavior: 'off/on outputs agree on four inputs',
    off: { ...replayCanaryProbes(off.code), gzipBytes: off.gzipBytes },
    on: { ...replayCanaryProbes(on.code), gzipBytes: on.gzipBytes, build: on.report },
    overhead: { bytes: on.bytes - off.bytes, gzipBytes: on.gzipBytes - off.gzipBytes },
    limitations: 'Tool-output marker encounter is not model-context exposure, refusal, or reverse-engineering resistance.',
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLocalBenchmark().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
    .catch(() => { process.stderr.write('Local canary benchmark failed\n'); process.exitCode = 1 })
}
