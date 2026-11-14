import { CanaryCore } from './canary.mjs'
import remapping from '@jridgewell/remapping'

export function createCanaryVite(options) {
  const core = new CanaryCore(options)
  let enabled = true
  return {
    name: 'anti-llm-canary',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      core.root = config.root ?? process.cwd()
      enabled = !config.build.ssr && config.mode !== 'test'
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
                const result = minifySync(chunk.fileName, code, {
                  ...settings, module: !output.format || ['es', 'esm', 'module'].includes(output.format),
                  sourcemap: Boolean(output.sourcemap),
                  mangle: settings.mangle === false ? false : { ...mangle, reserved: [...new Set([...(mangle.reserved ?? []), ...core.reserved])] },
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
