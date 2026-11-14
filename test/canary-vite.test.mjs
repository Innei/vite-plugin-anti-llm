import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SourceMap } from 'node:module'
import { build } from 'vite'
import antiLLM from '../src/index.mjs'
import { SourceEditor } from '../src/editor.mjs'

const source = `/** @anti-llm internal_sum */
export function sum(values) {
  "use strict";
  let privateAccumulator = 0;
  for (const item of values) privateAccumulator += item * 2;
  return privateAccumulator;
}
export function untouched(value) { return value + 9; }`

async function fixture(options = {}, code = source, minify = 'oxc', outputOptions, extraPlugins = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-vite-'))
  try {
    const entry = path.join(root, 'entry.js')
    await writeFile(entry, code)
    const result = await build({ root, configFile: false, logLevel: 'silent',
      plugins: [antiLLM({ mode: 'canary', strict: true, report: true, ...options }), ...extraPlugins],
      build: { write: false, minify, sourcemap: true,
        lib: { entry, formats: ['es'], fileName: () => 'bundle.mjs' }, rolldownOptions: { output: outputOptions } },
    })
    const output = (Array.isArray(result) ? result : [result]).flatMap(result => result.output)
    const chunk = output.find(item => item.type === 'chunk')
    const report = output.find(item => item.fileName === 'anti-llm-report.json')
    return { code: chunk.code, map: JSON.parse(output.find(item => item.fileName === 'bundle.mjs.map').source),
      report: report && JSON.parse(report.source) }
  } finally { await rm(root, { recursive: true, force: true }) }
}
const execute = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('real Vite minification retains both neutral marker forms inside selected functions', async () => {
  const built = await fixture()
  const compiled = await execute(built.code)
  assert.equal(compiled.sum([2, -3, 4]), 6)
  assert.equal(compiled.untouched(2), 11)
  assert.match(compiled.sum.toString(), /\/\*!.*AL_CANARY_[a-f0-9]+_C.*\*\//)
  assert.match(compiled.sum.toString(), /void\s*["']AL_CANARY_[a-f0-9]+_S["']/)
  assert.doesNotMatch(compiled.untouched.toString(), /AL_CANARY/)
  assert.doesNotMatch(built.code, /internal_sum|privateAccumulator/)
  assert.equal(built.report.sourceMarked, 1)
  assert.equal(built.report.targetsLocated, 1)
  assert.equal(built.report.commentsRetained, 1)
  assert.equal(built.report.stringsRetained, 1)
  assert.equal(built.report.targetsMissed, 0)
  assert.doesNotMatch(JSON.stringify(built.report), /internal_sum|privateAccumulator|entry\.js|canary-vite-/)
  const firstBinding = built.code.indexOf('__al_')
  const lines = built.code.slice(0, firstBinding).split('\n')
  const traced = new SourceMap(built.map).findEntry(lines.length - 1, lines.at(-1).length)
  assert.match(traced.originalSource, /entry\.js$/)
  assert.equal(traced.originalLine, 3)
})

test('off builds preserve behavior and remove all neutral instrumentation', async () => {
  const [off, on] = await Promise.all([fixture({ mode: 'off' }), fixture()])
  assert.doesNotMatch(off.code, /AL_CANARY|__al_|__antiLLM__/)
  assert.equal(off.report, undefined)
  for (const input of [[], [1, 2, 3], [-5, 0, 2]]) {
    assert.equal((await execute(off.code)).sum(input), (await execute(on.code)).sum(input))
  }
})

test('strict canary builds reject missing locations and each budget boundary', async () => {
  for (const options of [{ maxBytesPerFunction: 1 }, { maxBytesPerChunk: 1 }, { maxFunctionsPerChunk: 0 }]) {
    await assert.rejects(fixture(options), /canary.*budget/i)
  }
  await assert.rejects(fixture({}, '/** @anti-llm LOCAL_SENTINEL */ export function empty() { return 3; }'), error => {
    assert.doesNotMatch(error.message, /LOCAL_SENTINEL/)
    return /canary.*locat/i.test(error.message)
  })
})

test('unminified builds insert after directives and strict script behavior stays intact', async () => {
  const built = await fixture({}, source, false)
  const compiled = await execute(built.code)
  assert.equal(compiled.sum([2, 3]), 10)
  assert.match(compiled.sum.toString(), /AL_CANARY/)
})


test('canary minification preserves the caller legal-comment policy', async () => {
  const license = { name: 'fixture-license', renderChunk(code, chunk) {
    const editor = new SourceEditor(code, chunk.fileName)
    editor.insert(0, '/*! @license NEUTRAL_FIXTURE_LICENSE */\n')
    return editor.result()
  } }
  const built = await fixture({}, source, 'oxc', { comments: { legal: true } }, [license])
  assert.match(built.code, /NEUTRAL_FIXTURE_LICENSE/)
  assert.equal((await execute(built.code)).sum([2, 3]), 10)
})

test('external legal-comment extraction is rejected instead of losing the companion file', async () => {
  await assert.rejects(fixture({}, source, 'oxc', { minify: { codegen: { legalComments: 'external' } } }), /legal.comment/i)
})
