import test from 'node:test'
import assert from 'node:assert/strict'
import { build, context } from 'esbuild'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire, SourceMap } from 'node:module'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import canary from '../src/esbuild.mjs'

const code = `/** @anti-llm private_cli_target */
export function calculate(values: number[]) {
  "use strict";
  let privateAccumulator = 0;
  for (const value of values) privateAccumulator += value * 2;
  return privateAccumulator;
}
if (require.main === module) {
  const values = (process.argv[2] || '').split(',').filter(Boolean).map(Number);
  if (values.some(Number.isNaN)) { process.stderr.write('invalid input\\n'); process.exitCode = 2; }
  else { process.stdout.write(String(calculate(values)) + '\\n'); process.stderr.write('fixture-note\\n'); }
}`

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-esbuild-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const entry = path.join(root, 'entry.ts')
  await writeFile(entry, code)
  return { root, entry, build: async (mode, extra = {}) => {
    const outfile = path.join(root, `${mode}.cjs`)
    const result = await build({ absWorkingDir: root, entryPoints: [entry], outfile,
      bundle: true, platform: 'node', format: 'cjs', minify: true, sourcemap: true,
      logLevel: 'silent', plugins: [canary({ mode, report: true })], ...extra })
    return { outfile, result }
  } }
}

test('single-CJS adapter retains neutral markers and preserves stdout, stderr and exits', async t => {
  const fixture = await fixtureFor(t)
  const off = await fixture.build('off')
  const on = await fixture.build('canary')
  const compiled = createRequire(import.meta.url)(on.outfile)
  assert.equal(compiled.calculate([2, -3, 4]), 6)
  assert.match(compiled.calculate.toString(), /AL_CANARY_[a-f0-9]+_C/)
  assert.match(compiled.calculate.toString(), /void\s*["']AL_CANARY_[a-f0-9]+_S["']/)
  assert.doesNotMatch(await readFile(on.outfile, 'utf8'), /private_cli_target|privateAccumulator/)
  assert.doesNotMatch(await readFile(off.outfile, 'utf8'), /AL_CANARY|__al_/)
  for (const input of ['', '1,2,3', '-1,2', 'bad']) {
    const run = file => {
      const result = spawnSync(process.execPath, [file, input], { encoding: 'utf8' })
      return { stdout: result.stdout, stderr: result.stderr, status: result.status }
    }
    assert.deepEqual(run(on.outfile), run(off.outfile))
  }
  const report = JSON.parse(await readFile(path.join(fixture.root, 'anti-llm-report.json'), 'utf8'))
  assert.equal(report.commentsRetained, 1)
  assert.equal(report.stringsRetained, 1)
  assert.doesNotMatch(JSON.stringify(report), /private_cli_target|entry\.ts|privateAccumulator/)
})
const fixtureFor = fixture

test('adapter write:false output and sourcemaps describe the final transformed bytes', async t => {
  const fixture = await fixtureFor(t)
  const { outfile, result } = await fixture.build('canary', { write: false })
  const output = result.outputFiles.find(file => file.path === outfile)
  assert.match(output.text, /AL_CANARY/)
  assert.equal(output.text, Buffer.from(output.contents).toString())
  const map = new SourceMap(JSON.parse(result.outputFiles.find(file => file.path === outfile + '.map').text))
  const source = ts.createSourceFile('output.cjs', output.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.body?.getText(source).includes('AL_CANARY_')) {
      const statement = node.body.statements.find(ts.isVariableStatement)
      declaration = statement?.declarationList.declarations[0].name
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(declaration)
  const position = source.getLineAndCharacterOfPosition(declaration.getStart(source))
  const original = map.findEntry(position.line, position.character)
  assert.match(original.originalSource, /entry\.ts$/)
  assert.equal(original.originalLine, 3)
})

test('adapter rejects unsupported layouts before writing output', async t => {
  const fixture = await fixtureFor(t)
  await assert.rejects(fixture.build('canary', { format: 'esm', splitting: true }), /single.*CJS|splitting/i)
})

test('rebuild resets target counts instead of accumulating prior builds', async t => {
  const fixture = await fixtureFor(t)
  const ctx = await context({ absWorkingDir: fixture.root, entryPoints: [fixture.entry], outfile: path.join(fixture.root, 'rebuild.cjs'),
    bundle: true, platform: 'node', format: 'cjs', minify: true, write: false,
    plugins: [canary({ mode: 'canary', report: true })], logLevel: 'silent' })
  t.after(() => ctx.dispose())
  for (let index = 0; index < 2; index++) {
    const result = await ctx.rebuild()
    const report = JSON.parse(result.outputFiles.find(file => file.path.endsWith('anti-llm-report.json')).text)
    assert.equal(report.sourceMarked, 1)
    assert.equal(report.targetsLocated, 1)
  }
})
