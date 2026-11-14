import { CanaryCore } from './canary.mjs'

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
  }
}
