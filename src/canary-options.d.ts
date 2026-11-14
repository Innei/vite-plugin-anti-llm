export interface CanaryOptions {
  mode?: 'off' | 'canary'
  maxLocalRenames?: number
  injectComments?: boolean
  injectStrings?: boolean
  maxFunctionsPerChunk?: number
  maxBytesPerFunction?: number
  maxBytesPerChunk?: number
  strict?: boolean
  report?: boolean
}
