import test from 'node:test'
import assert from 'node:assert/strict'
import antiLLM from '../src/index.mjs'

const setup = mode => {
  const plugin = antiLLM({ mode, maxLocalRenames: 2 })
  plugin.configResolved?.({ root: '/fixture', build: {}, mode: 'production' })
  return plugin
}
const execute = async code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('canary mode uses opaque bindings while preserving shorthand keys and closures', async () => {
  const source = `/** @anti-llm private_target */
export function calculate(input) {
  const proprietaryTemp = input + 3;
  const anotherSecret = () => proprietaryTemp * 2;
  return { proprietaryTemp, result: anotherSecret() };
}`
  const result = setup('canary').transform(source, '/fixture/input.js')
  assert.ok(result)
  assert.doesNotMatch(result.code, /@anti-llm|private_target|proprietaryTemp__ai_|anotherSecret__ai_/)
  assert.match(result.code, /const __al_[a-f0-9]+/)
  assert.deepEqual((await execute(result.code)).calculate(4), { proprietaryTemp: 7, result: 14 })
})

test('off removes compile-time macros without renaming bindings or adding markers', async () => {
  const source = `export function calculate(input) { __antiLLM__('private_target'); const value = input + 3; return value; }`
  const result = setup('off').transform(source, '/fixture/input.js')
  assert.ok(result)
  assert.doesNotMatch(result.code, /__antiLLM__|__al_|AI_CANARY/)
  assert.match(result.code, /const value/)
  assert.equal((await execute(result.code)).calculate(4), 7)
})

test('canary IDs are stable across checkout roots and preserve unselected code', () => {
  const source = `/** @anti-llm private_target */ function picked(x) { const value = x + 3; return value; }
function untouched(x) { const publicValue = x + 4; return publicValue; }`
  const first = setup('canary').transform(source, '/fixture/src/input.js')
  const secondPlugin = antiLLM({ mode: 'canary' })
  secondPlugin.configResolved?.({ root: '/other-checkout', build: {}, mode: 'production' })
  const second = secondPlugin.transform(source, '/other-checkout/src/input.js')
  assert.equal(first.code, second.code)
  assert.match(first.code, /const publicValue = x \+ 4/)
})

test('canary rejects custom content and unknown modes without echoing supplied text', () => {
  assert.throws(() => antiLLM({ mode: 'canary', customProfiles: { sample: 'LOCAL_SENTINEL_NOT_FOR_LOGS' } }), error => {
    assert.doesNotMatch(error.message, /LOCAL_SENTINEL_NOT_FOR_LOGS/)
    return /custom|unsupported/i.test(error.message)
  })
  assert.throws(() => antiLLM({ mode: 'not-a-mode' }), /mode/i)
})
