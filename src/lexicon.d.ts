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
interface LexiconEntryData {
  id: string
  revision: number
  /** Literal untrusted text, preserved without normalization. */
  text: string
  category: LexiconCategory
  /** Intended layer is a hypothesis, not measured attribution. */
  intendedLayer: LexiconLayer
  locale: string
  placements: LexiconPlacement[]
  targets: LexiconTarget[]
  evaluation: LexiconEvaluation
}
export type LexiconEntry = LexiconEntryData & (
  { enabled: false; review: LexiconReview }
  | { enabled: true; review: { status: 'approved'; reviewerId: string; reviewedAt: string } }
)
export interface LexiconManifest {
  schemaVersion: 1
  catalogId: string
  revision: number
  entries: LexiconEntry[]
}
export interface LexiconIssue { path: string; code: string }
export type LexiconValidation = { valid: true; issues: [] }
  | { valid: false; issues: LexiconIssue[] }
export declare function validateLexiconManifest(value: unknown): LexiconValidation
/** Parses a self-contained JSON catalog and throws sanitized errors. No I/O. */
export declare function parseLexiconManifest(source: string): LexiconManifest
