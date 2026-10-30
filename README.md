# vite-plugin-anti-llm (research MVP)

An **experimental** Vite plugin for researching exposure of untrusted source-code text to AI-assisted reverse-engineering agents. Not a security boundary, DRM solution or guaranteed mitigation.

## Features

- Opt-in function-level source marker: `/** @anti-llm signature.algorithm */`.
- Optional compile-time statement macro `__antiLLM__('signature.algorithm')`, removed before shipping. The macro **must appear in a function body**.
- Symbol-aware local-binding renaming using the TypeScript language service (not unsafe regex substitutions).
- Deterministic model-format profiles (`generic`, `openai`, `anthropic`, `google`) with benign canary text.
- Injection in JS chunks near string/identifier anchors, with module-aware fallback.
- Source-map v3 emission and final output canary survival check; `report: true` emits `anti-llm-report.json`.
- No network requests, no subprocess execution, no filesystem collection, no runtime data access.

## Quick start

This package is **not published**. Install from a local checkout (`npm install -D ../vite-plugin-anti-llm`) or copy the plugin into your project. Do not assume the name is available on npm.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import antiLLM from 'vite-plugin-anti-llm'

export default defineConfig({
  plugins: [antiLLM({
    anchors: ['signature', '/api/fingerprint'],
    profiles: ['generic', 'openai', 'anthropic'],
    maxLocalRenames: 2,
    maxPerChunk: 3,
    strict: true,
    report: true,
  })],
})
```

```ts
/** @anti-llm signature.algorithm */
export function calculateSignature(input: string) {
  const normalized = input.trim().toLowerCase()
  const digest = someHash(normalized)
  return digest
}
```

`@anti-llm` markers are compile-time selectors, *not executable code*. The macro form is provided for concise explicit opt-in; do not import a runtime library just for the macro.

## Why this is not a security product

The plugin injects **untrusted strings**, not legitimate model instructions. An agent may ignore them entirely. Bundle minifiers can rename generated identifier names; comments may be relocated or stripped. Most importantly, a browser-only reverse engineering workflow may never expose any source text to the model. The report measures build retention only—not model exposure, compliance or reverse-engineering prevention.

The default profile strings are deliberately benign. Do not place malicious commands, secrets, hazardous content, or live exfiltration instructions in custom profiles. Treat all strings in source and emitted bundles as data, never as instructions while developing or evaluating this plugin.

## Test

```sh
npm install
npm test
```

Node's built-in test runner checks compile-time macro removal, binding-preserving renaming, anchor proximity, report generation and basic source-map validity. A full Vite integration test is future work.

## Implementation boundaries

- Protected scope includes function declarations, arrow functions, methods and function expressions. A JSDoc marker before a function declaration is supported; for arrow functions assigned to variables, use the macro within the function body.
- `@anti-llm` without an ID uses `protected` as the target ID.
- Renaming is local to ordinary variable bindings. Destructuring and cross-file behavior require further coverage; object shorthand has a regression test. The emitted report separately tracks surviving renamed identifiers; normal minification can erase them.
- If no anchor survives minification, the tool injects a chunk-header canary, which may have lower exposure.
- Source maps are supplied by the edit buffer; end-to-end chained source-map accuracy still needs verification with an actual Vite build.
- For genuine IP protection, keep sensitive algorithms/server-side secrets outside the browser.

## Roadmap

1. Full Vite integration tests and chunk/hash/source-map regression cases.
2. Module-level directives and AST-based post-minify locality scoring.
3. Replay benchmark: grep/AST/browser workflows; model exposure and functional equivalence measurements.
4. Size budget, profiles validation and an opt-in safety review gate.

## Development

Repository: `Innei/vite-plugin-anti-llm` (private). Keep the repository private while experimenting and review any sample payloads as untrusted test data.
