import assert from 'node:assert/strict'
import test from 'node:test'
import antiLLM from '../src/index.mjs'

// Use synthetic, inert fixtures. Generated source is only inspected as text.
function fixture() {
  const p = antiLLM({ maxLocalRenames: 1, maxPerChunk: 0, report: true })
  p.configResolved({ mode: 'production', build: { ssr: false, sourcemap: false } })
  const source = `/** @anti-llm metric */ function compute(value) {
    const digest = value.trim()
    return digest.length
  }`
  const changed = p.transform(source, '/proj/src/calc.ts')
  assert.ok(changed)
  const name = changed.code.match(/digest__ai_metric_generic_[a-f0-9]{8}/)?.[0]
  assert.ok(name, 'expected a single renamed local variable')
  return { p, name }
}

function reportFor(p, code) {
  const emitted = []
  p.generateBundle.call({
    emitFile: file => emitted.push(file),
    info: () => {},
    error: message => { throw new Error(message) },
  }, {}, { 'assets/calc.js': { type: 'chunk', fileName: 'assets/calc.js', code } })
  assert.equal(emitted.length, 1)
  return JSON.parse(emitted[0].source)
}

test('quoted, commented, regex and longer-name decoys do not count as surviving identifiers', () => {
  const { p, name } = fixture()
  const code = [
    `// ${name}`,
    `const quoted = ${JSON.stringify(name)};`,
    `const pattern = /${name}/;`,
    'const template = `' + name + '`;',
    `const ${name}Suffix = 1;`,
  ].join('\n')
  const report = reportFor(p, code)
  assert.equal(report.sourceRenamed, 1)
  assert.equal(report.identifiersRetained, 0)
})

test('exact generated identifier token is counted once across declarations and references', () => {
  const { p, name } = fixture()
  const code = `const ${name} = 4; console.log(${name});`
  const report = reportFor(p, code)
  assert.equal(report.sourceRenamed, 1)
  assert.equal(report.identifiersRetained, 1)
})
