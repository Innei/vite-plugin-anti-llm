import test from 'node:test'
import assert from 'node:assert/strict'
import { CanaryCore } from '../src/canary.mjs'

const source = '/** @anti-llm sample */ function selected(value) { "use strict"; let total = value; total += 2; return [this, total]; } function other() { return 0; }'
function fixture() {
  const core = new CanaryCore()
  core.root = '/fixture'
  const transformed = core.transform(source, '/fixture/input.js')
  return { core, final: core.finalize(transformed.code, 'bundle.js', ['/fixture/input.js']) }
}

test('inert string placement preserves strict-script this and return behavior', () => {
  const { final } = fixture()
  const compiled = new Function(`${final.code}; return selected;`)()
  assert.deepEqual(compiled(4), [undefined, 6])
})

test('final retention rejects a comment moved to a different function', () => {
  const { core, final } = fixture()
  const comment = final.code.match(/\/\*! @preserve AL_CANARY_[a-f0-9]+_C \*\//)[0]
  const moved = final.code.replace(comment, '').replace('function other() {', 'function other() {' + comment)
  assert.throws(() => core.verify([{ fileName: 'bundle.js', code: moved }]), /retention/i)
})

test('unrelated marker text cannot hide removed executable markers', () => {
  const { core, final } = fixture()
  const marker = final.code.match(/AL_CANARY_[a-f0-9]+_S/)[0]
  const removed = final.code.replace(`void "${marker}";`, '') + `\nconst unrelated = ${JSON.stringify(marker)};`
  assert.throws(() => core.verify([{ fileName: 'bundle.js', code: removed }]), /retention/i)
})

test('strict output checks count a completely removed target as a location miss', () => {
  const core = new CanaryCore()
  core.root = '/fixture'
  core.transform(source, '/fixture/unused.js')
  core.finalize('export const value = 1;', 'bundle.js', ['/fixture/main.js'])
  assert.throws(() => core.verify([{ fileName: 'bundle.js', code: 'export const value = 1;' }]), /location/i)
})
