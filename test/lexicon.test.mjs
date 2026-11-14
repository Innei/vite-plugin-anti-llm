import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as lexicon from '../src/lexicon.mjs'

const sample = () => ({
  schemaVersion: 1, catalogId: 'sample', revision: 1,
  entries: [{
    id: 'n001', revision: 1, resourceId: 'r001', enabled: false,
    category: 'retention-canary', intendedLayer: 'unknown', locale: 'en',
    placements: ['function-comment', 'function-string'],
    targets: [
      { kind: 'agent', id: 'codex', family: 'international' },
      { kind: 'model', id: 'unspecified', family: 'domestic' },
    ],
    review: { status: 'draft' },
    integrity: { encoding: 'utf-8', bytes: 3, sha256: 'a'.repeat(64) },
    evaluation: { status: 'not-tested', evidenceIds: [] },
  }],
})

test('manifest validation accepts draft metadata for both target families without mutating it', async () => {
  const { validateLexiconManifest, parseLexiconManifest } = lexicon
  const manifest = sample()
  const before = structuredClone(manifest)
  assert.deepEqual(validateLexiconManifest(manifest), { valid: true, issues: [] })
  assert.deepEqual(manifest, before)
  assert.deepEqual(parseLexiconManifest(JSON.stringify(manifest)), before)
  assert.deepEqual(validateLexiconManifest({ ...manifest, entries: [] }), { valid: true, issues: [] })
})

test('inline content and malformed metadata are rejected without echoing values or unknown keys', async () => {
  const { validateLexiconManifest, parseLexiconManifest } = lexicon
  const sentinel = 'NEUTRAL_PRIVATE_SENTINEL'
  const cases = [
    value => { value[sentinel] = sentinel },
    value => { value.entries[0].text = sentinel },
    value => { value.entries[0].review.text = sentinel },
    value => { value.entries[0].targets[0].text = sentinel },
    value => { value.entries[0].category = sentinel },
    value => { value.entries[0].resourceId = '../resource' },
    value => { value.entries[0].integrity.bytes = -1 },
    value => { value.entries[0].integrity.sha256 = 'not-a-digest' },
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

test('duplicate entries and conflicting integrity for a shared resource are rejected', async () => {
  const { validateLexiconManifest } = lexicon
  const manifest = sample()
  manifest.entries.push(structuredClone(manifest.entries[0]))
  assert.equal(validateLexiconManifest(manifest).valid, false)
  manifest.entries[1].id = 'n002'
  assert.equal(validateLexiconManifest(manifest).valid, true)
  manifest.entries[1].integrity.bytes = 4
  assert.equal(validateLexiconManifest(manifest).valid, false)
})

test('the separate neutral resource agrees with the public manifest integrity declaration', async () => {
  const { parseLexiconManifest } = lexicon
  const manifest = parseLexiconManifest(await readFile(new URL('../lexicon/examples/manifest.json', import.meta.url), 'utf8'))
  const resource = JSON.parse(await readFile(new URL('../lexicon/examples/neutral-resource.json', import.meta.url), 'utf8'))
  const entry = manifest.entries.find(entry => entry.resourceId === resource.resourceId)
  assert.ok(entry)
  assert.equal(Buffer.byteLength(resource.text, 'utf8'), entry.integrity.bytes)
  assert.equal(createHash('sha256').update(resource.text, 'utf8').digest('hex'), entry.integrity.sha256)
  assert.equal(entry.enabled, false)
})

test('the npm package includes manifest schemas but excludes the separate resource example', async () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const packed = JSON.parse(result.stdout)
  const artifact = Array.isArray(packed) ? packed[0] : Object.values(packed)[0]
  const files = artifact.files.map(file => file.path)
  assert.ok(files.includes('lexicon/manifest.schema.json'))
  assert.ok(files.includes('lexicon/resource.schema.json'))
  assert.ok(files.includes('lexicon/examples/manifest.json'))
  assert.ok(files.includes('lexicon/manifest.json'))
  assert.ok(!files.includes('lexicon/examples/neutral-resource.json'))
})
