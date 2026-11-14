export interface ProbeResult {
  outputBytes: number
  matchedCanaries: number
  fractionOfPresentCanaries: number | null
}
export interface EncounterReport {
  artifactBytes: number
  markerCount: number
  symbolResolved: boolean
  probes: Record<string, ProbeResult>
  caveat: string
}
export declare function replayCanaryProbes(code: string, options?: { symbol?: string }): EncounterReport
/** Returns only metadata. Confirmation is a caller assertion, not authentication or OS isolation. */
export declare function inspectArtifact(filename: string, options?: {
  confirmed?: boolean
  root?: string
  maxBytes?: number
  symbol?: string
}): Promise<{ status: 'confirmation-required' } | ({ status: 'inspected' } & EncounterReport)>
