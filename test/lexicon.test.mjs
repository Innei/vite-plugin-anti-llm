import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import * as lexicon from '../src/lexicon.mjs'

const sample = () => ({
  schemaVersion: 1, catalogId: 'sample', revision: 1,
  entries: [{
    id: 'n001', revision: 1, text: 'NEUTRAL_SAMPLE_示例\r\n', enabled: false,
    category: 'retention-canary', intendedLayer: 'unknown', locale: 'en',
    placements: ['function-comment', 'function-string'],
    targets: [
      { kind: 'agent', id: 'codex', family: 'international' },
      { kind: 'model', id: 'unspecified', family: 'domestic' },
    ],
    review: { status: 'draft' },
    evaluation: { status: 'not-tested', evidenceIds: [] },
  }],
})

test('a self-contained catalog round-trips bilingual text without mutating or normalizing it', async () => {
  const { validateLexiconManifest, parseLexiconManifest } = lexicon
  const manifest = sample()
  const before = structuredClone(manifest)
  assert.deepEqual(validateLexiconManifest(manifest), { valid: true, issues: [] })
  assert.deepEqual(manifest, before)
  assert.deepEqual(parseLexiconManifest(JSON.stringify(manifest)), before)
  assert.equal(parseLexiconManifest(JSON.stringify(manifest)).entries[0].text, 'NEUTRAL_SAMPLE_示例\r\n')
  assert.deepEqual(validateLexiconManifest({ ...manifest, entries: [] }), { valid: true, issues: [] })
})

test('missing or malformed text and metadata are rejected without echoing values or unknown keys', async () => {
  const { validateLexiconManifest, parseLexiconManifest } = lexicon
  const sentinel = 'NEUTRAL_PRIVATE_SENTINEL'
  const cases = [
    value => { value[sentinel] = sentinel },
    value => { value.entries[0][sentinel] = sentinel },
    value => { delete value.entries[0].text },
    value => { value.entries[0].text = '' },
    value => { value.entries[0].text = { [sentinel]: sentinel } },
    value => { value.entries[0].review.text = sentinel },
    value => { value.entries[0].targets[0].text = sentinel },
    value => { value.entries[0].category = sentinel },
    value => { value.entries[0].revision = 0 },
    value => { value.schemaVersion = 2 },
    value => { value.entries[0].enabled = 'false' },
  ]
  for (const mutate of cases) {
    const manifest = sample()
    mutate(manifest)
    const result = validateLexiconManifest(manifest)
    assert.equal(result.valid, false)
    assert.ok(result.issues.length)
    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel))
    assert.throws(() => parseLexiconManifest(JSON.stringify(manifest)), error => {
      assert.doesNotMatch(error.message, new RegExp(sentinel))
      return /lexicon/i.test(error.message)
    })
  }
  assert.throws(() => parseLexiconManifest('{"NEUTRAL_PRIVATE_SENTINEL":'), error => {
    assert.doesNotMatch(error.message, /NEUTRAL_PRIVATE_SENTINEL/)
    return /lexicon/i.test(error.message)
  })
})

test('enabled entries require completed approval while evaluation remains independently untested', async () => {
  const { validateLexiconManifest } = lexicon
  const manifest = sample()
  manifest.entries[0].enabled = true
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[0].review = { status: 'approved' }
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[0].review = { status: 'approved', reviewerId: 'maintainer', reviewedAt: '2026-11-14T08:00:00Z' }
  assert.equal(validateLexiconManifest(manifest).valid, true)
  manifest.entries[0].review.reviewedAt = '2026-02-30T08:00:00Z'
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[0].enabled = false
  manifest.entries[0].review = { status: 'draft' }
  manifest.entries[0].evaluation.status = 'retention-only'
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[0].evaluation.evidenceIds = ['local-fixture-v1']
  assert.equal(validateLexiconManifest(manifest).valid, true)
})

test('entry IDs remain unique regardless of whether their inline text differs', async () => {
  const { validateLexiconManifest } = lexicon
  const manifest = sample()
  manifest.entries.push(structuredClone(manifest.entries[0]))
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[1].text = 'ANOTHER_NEUTRAL_SAMPLE'
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[1].id = 'n002'
  assert.equal(validateLexiconManifest(manifest).valid, true)
})

test('the example catalog supplies usable text through the same parser without resource resolution', async () => {
  const { parseLexiconManifest } = lexicon
  const manifest = parseLexiconManifest(await readFile(new URL('../lexicon/examples/manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.entries.length)
  for (const entry of manifest.entries) {
    assert.equal(typeof entry.text, 'string')
    assert.ok(entry.text.length)
    assert.equal(entry.enabled, false)
  }
})

test('the npm package includes the catalog schema and self-contained example', async () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const packed = JSON.parse(result.stdout)
  const artifact = Array.isArray(packed) ? packed[0] : Object.values(packed)[0]
  const files = artifact.files.map(file => file.path)
  assert.ok(files.includes('lexicon/manifest.schema.json'))
  assert.ok(files.includes('lexicon/examples/manifest.json'))
  assert.ok(files.includes('lexicon/manifest.json'))
})
