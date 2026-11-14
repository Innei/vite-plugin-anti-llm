import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { build as viteBuild } from 'vite'
import { build as esbuild } from 'esbuild'
import antiLLM from '../src/index.mjs'
import canary from '../src/esbuild.mjs'

const names = `/** @anti-llm names */
export function readNames(input) {
  const NamedArrow = (() => 1);
  const NamedFunction = (function () {});
  const NamedClass = (class {});
  let LaterArrow; LaterArrow = () => 2;
  let LogicalClass; LogicalClass ??= class {};
  const value = input + 1;
  return [NamedArrow.name, NamedFunction.name, NamedClass.name, LaterArrow.name, LogicalClass.name, value];
}`
const expectedNames = ['NamedArrow', 'NamedFunction', 'NamedClass', 'LaterArrow', 'LogicalClass', 4]
const execute = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const cjs = code => {
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(code, sandbox)
  return sandbox.module.exports
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('ordinary local renaming preserves inferred callable names through JS and TS wrappers', async () => {
  const typed = names.replace('(() => 1)', '((() => 1) as (() => number))')
    .replace('(function () {})', '((function () {}) satisfies Function)')
    .replace('(class {})', '((class {})!)')
  for (const [filename, source] of [['names.js', names], ['names.ts', typed]]) {
    const plugin = antiLLM({ mode: 'canary', maxLocalRenames: 4 })
    plugin.configResolved({ root: '/fixture', build: {}, mode: 'production' })
    const transformed = plugin.transform(source, '/fixture/' + filename)
    const emitted = ts.transpileModule(transformed.code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    assert.deepEqual((await execute(emitted)).readNames(3), expectedNames)
  }
})

test('esbuild keepNames preserves runtime names while final canaries use later scalar locals', async t => {
  const root = await fixture(t)
  const entry = path.join(root, 'entry.ts')
  await writeFile(entry, names)
  const result = await esbuild({ absWorkingDir: root, entryPoints: [entry], outfile: path.join(root, 'bundle.cjs'),
    bundle: true, format: 'cjs', platform: 'node', minify: true, keepNames: true, write: false,
    plugins: [canary({ mode: 'canary', maxLocalRenames: 4 })], logLevel: 'silent' })
  const compiled = cjs(result.outputFiles.find(file => file.path.endsWith('.cjs')).text)
  assert.deepEqual(Array.from(compiled.readNames(3)), expectedNames)
  assert.match(compiled.readNames.toString(), /AL_CANARY/)
})

test('Vite canary compression respects effective transform and stricter caller targets', async t => {
  const root = await fixture(t)
  const entry = path.join(root, 'entry.js')
  await writeFile(entry, `/** @anti-llm sum */ export function sum(input) { let total = 0; for(const item of input) total += item; return total; }
export function get(input) { return input == null ? void 0 : input.value; }`)
  for (const settings of [
    { target: 'es2015' },
    { target: 'esnext', rolldownOptions: { transform: { target: 'es2015' } } },
    { target: 'esnext', rolldownOptions: { output: { minify: { compress: { target: 'es2015' } } } } },
    { target: 'es2015', rolldownOptions: { output: { minify: { compress: { target: 'esnext' } } } } },
    { target: 'chrome80', rolldownOptions: { output: { minify: { compress: { target: 'chrome60' } } } } },
  ]) {
    const result = await viteBuild({ root, configFile: false, logLevel: 'silent', plugins: [antiLLM({ mode: 'canary' })],
      build: { write: false, minify: 'oxc', lib: { entry, formats: ['es'], fileName: () => 'bundle.mjs' }, ...settings } })
    const chunk = (Array.isArray(result) ? result : [result]).flatMap(item => item.output).find(file => file.type === 'chunk')
    assert.doesNotMatch(chunk.code, /\?\./)
    const compiled = await execute(chunk.code)
    assert.equal(compiled.get(null), undefined)
    assert.equal(compiled.get({ value: 7 }), 7)
    assert.equal(compiled.sum([2, 3]), 5)
  }
})

test('esbuild resolves relative and absolute outputs under a symlinked working directory', async t => {
  const root = await fixture(t)
  const actual = path.join(root, 'actual')
  const linked = path.join(root, 'linked')
  await mkdir(actual)
  await symlink(actual, linked, 'dir')
  await writeFile(path.join(actual, 'entry.js'), '/** @anti-llm sum */ export function sum(input) { let total = 0; for (const value of input) total += value; return total; }')
  for (const outfile of ['nested/bundle.cjs', path.join(linked, 'absolute/bundle.cjs')]) {
    const result = await esbuild({ absWorkingDir: linked, entryPoints: ['entry.js'], outfile,
      bundle: true, format: 'cjs', platform: 'node', minify: true, write: false,
      plugins: [canary({ mode: 'canary' })], logLevel: 'silent' })
    const output = result.outputFiles.find(file => file.path.endsWith('.cjs'))
    assert.equal(cjs(output.text).sum([2, 3]), 5)
    assert.match(output.text, /AL_CANARY/)
  }
})
