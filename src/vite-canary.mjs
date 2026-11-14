import { CanaryCore } from './canary.mjs'
import remapping from '@jridgewell/remapping'

function combineTargets(...values) {
  const engines = new Map()
  for (const value of values.flat().filter(Boolean)) {
    const target = value === 'es6' ? 'es2015' : value
    const match = /^(.*?)(\d[\d.]*|next)$/.exec(target)
    if (!match) { engines.set(target, { target, version: [] }); continue }
    const version = match[2] === 'next' ? [Infinity] : match[2].split('.').map(Number)
    const previous = engines.get(match[1])
    let comparison = 0
    if (previous) for (let index = 0; index < Math.max(version.length, previous.version.length); index++) {
      const left = version[index] ?? 0
      const right = previous.version[index] ?? 0
      if (left !== right) { comparison = left < right ? -1 : 1; break }
    }
    if (!previous || comparison < 0) engines.set(match[1], { target, version })
  }
  return [...engines.values()].map(item => item.target)
}

export function createCanaryVite(options) {
  const core = new CanaryCore(options)
  let enabled = true
  let target
  return {
    name: 'anti-llm-canary',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      core.root = config.root ?? process.cwd()
      enabled = !config.build.ssr && config.mode !== 'test'
      target = config.build.rolldownOptions?.transform?.target
        ?? (config.build.target === false ? undefined : config.build.target)
    },
    buildStart() { core.reset() },
    transform(code, id) { return enabled ? core.transform(code, id) : null },
    outputOptions(output) {
      if (!enabled || options.mode === 'off') return null
      const minify = output.minify === 'dce-only' ? false : output.minify
      if (typeof minify === 'string') throw new Error('Canary minification requires Vite 8/Oxc')
      const session = new Map()
      return {
        ...output,
        minify: false,
        plugins: [output.plugins, {
          name: 'anti-llm-canary-output',
          renderChunk: {
            order: 'post',
            async handler(code, chunk) {
              let map = null
              if (minify) {
                const { minifySync } = await import('vite')
                const settings = typeof minify === 'object' ? minify : {}
                const mangle = typeof settings.mangle === 'object' ? settings.mangle : {}
                const compress = typeof settings.compress === 'object' ? settings.compress : {}
                const targets = combineTargets(target, compress.target)
                const codegen = typeof settings.codegen === 'object' ? settings.codegen : {}
                const legalComments = codegen.legalComments ?? (output.comments === true || output.comments?.legal ? 'inline' : 'none')
                if (legalComments === 'external' || typeof legalComments === 'object') {
                  throw new Error('Canary output does not support external legal-comment files')
                }
                const result = minifySync(chunk.fileName, code, {
                  ...settings, module: !output.format || ['es', 'esm', 'module'].includes(output.format),
                  sourcemap: Boolean(output.sourcemap),
                  compress: settings.compress === false ? false : { ...compress, target: targets.length ? targets : undefined },
                  mangle: settings.mangle === false ? false : { ...mangle, reserved: [...new Set([...(mangle.reserved ?? []), ...core.reserved])] },
                  codegen: {
                    ...codegen,
                    removeWhitespace: codegen.removeWhitespace ?? settings.codegen !== false,
                    legalComments,
                  },
                })
                if (result.errors.length) throw new Error('Canary minification failed')
                code = result.code
                map = result.map ?? null
              }
              const final = core.finalize(code, chunk.fileName, chunk.moduleIds, session)
              if (final) {
                if (final.map) map = map ? remapping([final.map, map], () => null) : final.map
                code = final.code
              }
              return { code, map }
            },
          },
          generateBundle: {
            order: 'post',
            handler(_, bundle) {
              const report = core.verify(Object.values(bundle).filter(item => item.type === 'chunk'), session)
              if (options.report) this.emitFile({ type: 'asset', fileName: 'anti-llm-report.json', source: JSON.stringify(report, null, 2) })
            },
          },
        }],
      }
    },
  }
}
