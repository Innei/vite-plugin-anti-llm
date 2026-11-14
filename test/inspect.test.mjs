import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspectArtifact, replayCanaryProbes } from '../src/inspect.mjs'

test('unconfirmed inspection does not even require a readable or existing file', async () => {
  assert.deepEqual(await inspectArtifact('/no-such-file/private.cjs', { confirmed: false }), { status: 'confirmation-required' })
})

test('confirmed inspection returns only metrics and confines reads to the compiled root', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-inspect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const compiled = path.join(root, 'dist')
  await mkdir(compiled)
  const file = path.join(compiled, 'bundle.cjs')
  await writeFile(file, 'function calculateSignature(){/*! @preserve AL_CANARY_0123456789ab_C */void "AL_CANARY_0123456789ab_S";return "LOCAL_PRIVATE_SENTINEL";}')
  const result = await inspectArtifact(file, { confirmed: true, root: compiled })
  assert.equal(result.status, 'inspected')
  assert.equal(result.markerCount, 2)
  assert.doesNotMatch(JSON.stringify(result), /LOCAL_PRIVATE_SENTINEL|function calculate|bundle\.cjs/)
  const outside = path.join(root, 'outside.cjs')
  await writeFile(outside, 'LOCAL_PRIVATE_SENTINEL')
  await symlink(outside, path.join(compiled, 'linked.cjs'))
  for (const target of [outside, path.join(compiled, 'linked.cjs'), path.join(compiled, 'source.map')]) {
    await assert.rejects(inspectArtifact(target, { confirmed: true, root: compiled }), error => {
      assert.doesNotMatch(error.message, /LOCAL_PRIVATE_SENTINEL|outside\.cjs|source\.map/)
      return /inspection/i.test(error.message)
    })
  }
  await assert.rejects(inspectArtifact(file, { confirmed: true, root: compiled, maxBytes: 1 }), /inspection/i)
})

test('bounded extraction reports zero encounters separately and observes strings after comment stripping', () => {
  const source='function calculateSignature(){/*! @preserve AL_CANARY_0123456789ab_C */void "AL_CANARY_0123456789ab_S";return 3;}'
  const result=replayCanaryProbes(source, { symbol: 'calculateSignature' })
  assert.equal(result.markerCount, 2)
  assert.equal(result.probes['ast-without-comments'].matchedCanaries, 1)
  const clean=replayCanaryProbes('function calculateSignature(){return 3;}', { symbol: 'calculateSignature' })
  assert.equal(clean.markerCount, 0)
  assert.equal(clean.probes['symbol-window-384B'].matchedCanaries, 0)
  assert.equal(clean.probes['symbol-window-384B'].fractionOfPresentCanaries, null)
})
