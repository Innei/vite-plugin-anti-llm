import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import ts from 'typescript';
import { build } from 'vite';

import antiLLM from '../src/index.mjs';

test('minification preserves protected bindings and caller reservations while mangling ordinary bindings', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'anti-llm-identifiers-'));
  try {
    const entry = path.join(root, 'entry.js');
    await writeFile(
      entry,
      `
      /** @anti-llm protected */
      export function calculate(values) {
        let total = 0;
        for (const value of values) total += value * 2;
        return total;
      }
      export function reserveExisting(values) {
        let callerReserved = 0;
        for (const ordinaryTemporaryValue of values) callerReserved += ordinaryTemporaryValue;
        return callerReserved;
      }
    `,
    );
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [antiLLM({ maxPerChunk: 0, report: true })],
      build: {
        write: false,
        sourcemap: true,
        lib: { entry, formats: ['es'], fileName: () => 'bundle.mjs' },
        minify: 'oxc',
        rolldownOptions: {
          output: {
            minify: { compress: false, mangle: { reserved: ['callerReserved'] }, codegen: true },
          },
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((build) => build.output);
    const chunk = output.find((item) => item.type === 'chunk');
    const report = JSON.parse(output.find((item) => item.fileName === 'anti-llm-report.json').source);
    const source = ts.createSourceFile('output.js', chunk.code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const bindings = new Set();
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bindings.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(
      [...bindings].some((name) => name.includes('__ai_protected_generic_')),
      'protected identifiers were mangled',
    );
    assert.equal(report.identifiersRetained, report.sourceRenamed);
    assert.ok(bindings.has('callerReserved'), 'the caller reservation was discarded: ' + chunk.code);
    assert.ok(!bindings.has('ordinaryTemporaryValue'), 'ordinary bindings stopped being mangled');
    const map = new SourceMap(JSON.parse(output.find((item) => item.fileName === 'bundle.mjs.map').source));
    const position = chunk.code.indexOf('total__ai_protected_generic_');
    const preceding = chunk.code.slice(0, position).split('\n');
    const original = map.findEntry(preceding.length - 1, preceding.at(-1).length);
    assert.match(original.originalSource, /entry\.js$/);
    assert.equal(original.originalLine, 3, 'the preserved binding must map to its original declaration');
    const compiled = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
    assert.equal(compiled.calculate([2, 3]), 10);
    assert.equal(compiled.reserveExisting([1, 2, 3]), 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
