import type { Plugin } from 'esbuild'
import type { CanaryOptions } from './canary-options.js'

export type { CanaryOptions } from './canary-options.js'
export declare const CANARY_API_VERSION: 1
/** Disabled by default. Supports one bundled CJS entry with an outfile. */
export declare function createAntiLLMEsbuild(options?: CanaryOptions): Plugin
export default createAntiLLMEsbuild
