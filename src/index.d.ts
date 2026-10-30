import type { Plugin } from 'vite'
export type ModelProfile = 'generic' | 'openai' | 'anthropic' | 'google' | (string & {})
export interface AntiLLMOptions {
  /** Strings that are likely to survive the bundling process, used as injection anchors. */
  anchors?: string[]
  /** How many local variable bindings per marked function to rename. */
  maxLocalRenames?: number
  /** Maximum comment canaries to insert in each emitted JS chunk. */
  maxPerChunk?: number
  /** Deterministic mixed set of profile names. */
  profiles?: ModelProfile[]
  /** Safe custom text; treated as untrusted input by all evaluators. */
  customProfiles?: Record<string, string>
  /** Fail the build when the generated canaries are absent from emitted chunks. */
  strict?: boolean
  /** Emit a bundled JSON report. */
  report?: boolean
}
export declare function createAntiLLM(options?: AntiLLMOptions): Plugin
export default createAntiLLM

