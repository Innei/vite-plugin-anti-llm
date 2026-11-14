export declare const LEXICON_SCHEMA_VERSION: 1
export type LexiconCategory = 'retention-canary' | 'analysis-notice' | 'semantic-noise'
  | 'instruction-redirection' | 'context-noise' | 'policy-sensitivity'
export type LexiconPlacement = 'function-comment' | 'function-string' | 'local-name'
export type LexiconLayer = 'agent' | 'model' | 'api' | 'unknown'
export interface LexiconTarget {
  kind: 'agent' | 'model' | 'provider'
  id: string
  family: 'international' | 'domestic' | 'unspecified'
}
export type LexiconReview = { status: 'draft'; reviewerId?: string; reviewedAt?: string }
  | { status: 'approved' | 'rejected'; reviewerId: string; reviewedAt: string }
export type LexiconEvaluation = { status: 'not-tested'; evidenceIds: [] }
  | { status: 'retention-only' | 'observed'; evidenceIds: [string, ...string[]] }
export interface LexiconIntegrity {
  encoding: 'utf-8'
  /** UTF-8 bytes of resource.text, excluding its JSON envelope. */
  bytes: number
  sha256: string
}
interface LexiconEntryMetadata {
  id: string
  revision: number
  resourceId: string
  category: LexiconCategory
  /** Intended layer is a hypothesis, not measured attribution. */
  intendedLayer: LexiconLayer
  locale: string
  placements: LexiconPlacement[]
  targets: LexiconTarget[]
  integrity: LexiconIntegrity
  evaluation: LexiconEvaluation
}
export type LexiconEntry = LexiconEntryMetadata & (
  { enabled: false; review: LexiconReview }
  | { enabled: true; review: { status: 'approved'; reviewerId: string; reviewedAt: string } }
)
export interface LexiconManifest {
  schemaVersion: 1
  catalogId: string
  revision: number
  entries: LexiconEntry[]
}
/** Separate untrusted data; neither the validator nor build adapters read these files. */
export interface LexiconResource {
  schemaVersion: 1
  resourceId: string
  encoding: 'utf-8'
  text: string
}
export interface LexiconIssue { path: string; code: string }
export type LexiconValidation = { valid: true; issues: [] }
  | { valid: false; issues: LexiconIssue[] }
export declare function validateLexiconManifest(value: unknown): LexiconValidation
/** Parses JSON metadata and throws sanitized errors; does not resolve resources. */
export declare function parseLexiconManifest(source: string): LexiconManifest
