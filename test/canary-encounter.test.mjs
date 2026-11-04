import assert from 'node:assert/strict'
import test from 'node:test'
import { canaries, replayToolOutputs, runEncounterBenchmark } from '../scripts/benchmark-canary-encounter.mjs'

test('bounded replay distinguishes artifact retention from tool-output encounter', () => {
  const marker = 'AI_CANARY_deadbeef_fixture'
  const code = '/*! @preserve ' + marker + ' */\nexport function calculateSignature() {return 3}'
  const result = replayToolOutputs(code)
  assert.deepEqual(canaries(code), [marker])
  assert.deepEqual(result.presentCanaries, [marker])
  assert.equal(result.probes['head-128B'].matchedCanaries, 1)
  // A symbol-specific line search does not automatically see unrelated preceding comments.
  assert.equal(result.probes['rg-symbol-512B'].matchedCanaries, 0)
  assert.equal(result.probes['full-read-4096B'].matchedCanaries, 1)
  assert.equal(replayToolOutputs('export const calculateSignature=3').probes['full-read-4096B'].fractionOfPresentCanaries, null)
})

test('real Vite clean/instrumented builds yield consistent encounter proxies', { timeout: 90_000 }, async () => {
  const report = await runEncounterBenchmark()
  assert.equal(report.cases.length, 4)
  for (const minifier of ['none', 'oxc']) {
    const clean = report.cases.find(item => item.minifier === minifier && item.variant === 'clean')
    const instrumented = report.cases.find(item => item.minifier === minifier && item.variant === 'instrumented')
    assert.ok(clean && instrumented)
    assert.deepEqual(clean.presentCanaries, [])
    assert.equal(clean.reportedInserted, 0)
    assert.ok(instrumented.reportedInserted >= 1)
    assert.equal(instrumented.reportedRetained, instrumented.presentCanaries.length)
    for (const result of [clean, instrumented]) {
      assert.ok(result.artifactBytes > 0)
      for (const probe of Object.values(result.probes)) {
        assert.ok(probe.matchedCanaries <= result.presentCanaries.length)
        assert.ok(probe.outputBytes <= 4096)
        assert.equal(
          probe.fractionOfPresentCanaries,
          result.presentCanaries.length ? probe.matchedCanaries / result.presentCanaries.length : null,
        )
      }
    }
  }
  console.log('Canary tool-output encounter proxy:', JSON.stringify(
    report.cases.map(item => ({
      minifier: item.minifier,
      variant: item.variant,
      artifactCanaries: item.presentCanaries.length,
      replayed: Object.fromEntries(
        Object.entries(item.probes).map(([name, probe]) => [name, probe.matchedCanaries]),
      ),
    })),
  ))
})
