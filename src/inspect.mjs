import { realpath, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const markers = text => new Set(text.match(/AL_CANARY_[a-f0-9]{12}_[CS]/g) ?? [])
const prefix = (text, bytes) => Buffer.from(text).subarray(0, bytes).toString()

export function replayCanaryProbes(code, { symbol = 'calculateSignature' } = {}) {
  const source = ts.createSourceFile('artifact.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (source.parseDiagnostics.length) throw new Error('Artifact inspection syntax failed')
  const definitions = new Map()
  const aliases = new Map()
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) definitions.set(node.name.text, node)
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        definitions.set(declaration.name.text, declaration.initializer)
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) aliases.set(element.name.text, element.propertyName?.text ?? element.name.text)
    }
  }
  const target = definitions.get(aliases.get(symbol) ?? symbol)
  const symbolOffset = code.indexOf(symbol)
  const outputs = {
    'head-128B': prefix(code, 128),
    'rg-symbol-512B': prefix(code.split(/\r?\n/).filter(line => line.includes(symbol)).slice(0, 2).join('\n'), 512),
    'symbol-window-384B': symbolOffset < 0 ? '' : prefix(code.slice(Math.max(0, symbolOffset - 96), symbolOffset + 320), 384),
    'full-read-4096B': prefix(code, 4096),
    'ast-function-4096B': target ? prefix(target.getText(source), 4096) : '',
    'ast-without-comments': target ? prefix(ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, target, source), 4096) : '',
  }
  const present = markers(code)
  const probes = {}
  for (const [name, text] of Object.entries(outputs)) {
    const found = markers(text)
    const matches = [...present].filter(marker => found.has(marker)).length
    probes[name] = { outputBytes: Buffer.byteLength(text), matchedCanaries: matches,
      fractionOfPresentCanaries: present.size ? matches / present.size : null }
  }
  return { artifactBytes: Buffer.byteLength(code), markerCount: present.size, symbolResolved: Boolean(target), probes,
    caveat: 'Deterministic tool-output encounter proxy only; no model service called or model efficacy measured.' }
}

/** Cooperative metadata-only entry point, not an OS permission or human identity boundary. */
export async function inspectArtifact(filename, options = {}) {
  if (options.confirmed !== true) return { status: 'confirmation-required' }
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024
  const refuse = reason => { throw new Error(`Artifact inspection refused: ${reason}`) }
  if (typeof filename !== 'string' || !/\.(?:cjs|mjs|js)$/.test(filename) || typeof options.root !== 'string') refuse('compiled root required')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 32 * 1024 * 1024) refuse('invalid size budget')
  let root, file, details
  try {
    root = await realpath(options.root)
    file = await realpath(filename)
    details = await stat(file)
  } catch { throw new Error('Artifact inspection failed') }
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) refuse('outside compiled root')
  if (!details.isFile() || details.size > maxBytes) refuse('size budget exceeded')
  let data
  try { data = await readFile(file) } catch { throw new Error('Artifact inspection failed') }
  if (data.byteLength > maxBytes) refuse('size budget exceeded')
  return { status: 'inspected', ...replayCanaryProbes(data.toString('utf8'), { symbol: options.symbol }) }
}
