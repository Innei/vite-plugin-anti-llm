import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { SourceMap } from 'node:module'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { transform } from 'esbuild'
import remapping from '@jridgewell/remapping'
import { CanaryCore } from './canary.mjs'

export { CANARY_API_VERSION } from './canary.mjs'

function outputFile(filename, text) {
  const contents = Buffer.from(text)
  return { path: filename, contents, hash: createHash('sha256').update(contents).digest('base64'),
    get text() { return Buffer.from(this.contents).toString() } }
}

function originalBindings(core, code, map) {
  const source = ts.createSourceFile('bundle.cjs', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const positions = new Map()
  const visit = node => {
    if (ts.isIdentifier(node) && core.reserved.has(node.text)) positions.set(node.getStart(source), node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const lineStarts = source.getLineStarts()
  const trace = new SourceMap(JSON.parse(map))
  return (position, generated) => {
    const { line, character } = generated.getLineAndCharacterOfPosition(position)
    const entry = trace.findEntry(line, character)
    if (entry.generatedLine !== line || entry.generatedColumn !== character || entry.originalLine === undefined) return undefined
    return positions.get(lineStarts[entry.originalLine] + entry.originalColumn)
  }
}

export function createAntiLLMEsbuild(options = {}) {
  const mode = options.mode ?? 'off'
  if (mode !== 'off' && mode !== 'canary') throw new Error('Unsupported anti-LLM mode')
  const core = new CanaryCore({ ...options, mode })
  return {
    name: 'anti-llm-canary',
    setup(build) {
      const initial = build.initialOptions
      core.root = initial.absWorkingDir ?? process.cwd()
      const requestedMap = initial.sourcemap ?? false
      const requestedWrite = initial.write !== false
      const identifiers = initial.minifyIdentifiers ?? Boolean(initial.minify)
      const whitespace = initial.minifyWhitespace ?? Boolean(initial.minify)
      const syntax = initial.minifySyntax ?? Boolean(initial.minify)
      if (mode === 'canary') {
        const entries = initial.entryPoints
        if (!initial.bundle || initial.format !== 'cjs' || initial.splitting || !initial.outfile || initial.outdir
          || !entries || Object.keys(entries).length !== 1) {
          throw new Error('Canary adapter requires one bundled single-file CJS output; splitting is unsupported')
        }
        initial.write = false
        initial.minify = false
        initial.minifyWhitespace = whitespace
        initial.minifySyntax = syntax
        initial.minifyIdentifiers = false
        if (requestedMap) initial.sourcemap = 'external'
      }
      build.onStart(() => core.reset())
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, async args => {
        if (/[\\/]node_modules[\\/]/.test(args.path)) return undefined
        const input = await readFile(args.path, 'utf8')
        const result = core.transform(input, args.path)
        if (!result) return undefined
        const extension = path.extname(args.path).slice(1)
        const loader = ['mts', 'cts'].includes(extension) ? 'ts' : ['mjs', 'cjs'].includes(extension) ? 'js' : extension
        const map = requestedMap && result.map
          ? '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(result.map)).toString('base64') : ''
        return { contents: result.code + map, loader, resolveDir: path.dirname(args.path) }
      })
      if (mode === 'off') return
      build.onEnd(async result => {
        if (result.errors.length) return
        const outfile = path.resolve(core.root, initial.outfile)
        const files = result.outputFiles ?? []
        const javascript = files.find(file => file.path === outfile)
        if (!javascript) throw new Error('Canary CJS output missing')
        const mapFile = files.find(file => file.path === outfile + '.map')
        let code = javascript.text
        let map = mapFile ? JSON.parse(mapFile.text) : null
        let resolveIdentifier
        if (identifiers) {
          const renamed = await transform(code, {
            sourcefile: outfile, format: 'cjs', platform: initial.platform ?? 'node', target: initial.target,
            minifyIdentifiers: true, minifySyntax: false, minifyWhitespace: whitespace, treeShaking: false,
            sourcemap: 'external', legalComments: 'inline', keepNames: initial.keepNames,
            charset: initial.charset, supported: initial.supported,
          })
          resolveIdentifier = originalBindings(core, code, renamed.map)
          map = map ? remapping([renamed.map, map], () => null) : null
          code = renamed.code
        }
        const session = new Map()
        const final = core.finalize(code, outfile, [...core.targets.keys()], session, resolveIdentifier)
        if (final) {
          if (map && final.map) map = remapping([final.map, map], () => null)
          code = final.code
        }
        const report = core.verify([{ fileName: outfile, code }], session)
        if (map && (requestedMap === 'inline' || requestedMap === 'both')) {
          code += '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(map)).toString('base64') + '\n'
        } else if (map && requestedMap !== 'external') {
          code += `\n//# sourceMappingURL=${path.basename(outfile)}.map\n`
        }
        const output = files.filter(file => file.path !== outfile && file.path !== outfile + '.map')
        output.push(outputFile(outfile, code))
        if (map && requestedMap !== 'inline') output.push(outputFile(outfile + '.map', JSON.stringify(map)))
        if (options.report) output.push(outputFile(path.join(path.dirname(outfile), 'anti-llm-report.json'), JSON.stringify(report, null, 2)))
        if (requestedWrite) {
          for (const file of output) {
            await mkdir(path.dirname(file.path), { recursive: true })
            await writeFile(file.path, file.contents)
          }
          result.outputFiles = undefined
        } else result.outputFiles = output
      })
    },
  }
}

export default createAntiLLMEsbuild
