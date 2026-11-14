import antiLLM, { type AntiLLMOptions } from 'vite-plugin-anti-llm'
import canaryEsbuild from 'vite-plugin-anti-llm/esbuild'
import { inspectArtifact, replayCanaryProbes, type EncounterReport } from 'vite-plugin-anti-llm/inspect'
import {
  parseLexiconManifest,
  validateLexiconManifest,
  type LexiconEntry,
  type LexiconManifest,
} from 'vite-plugin-anti-llm/lexicon'

const options: AntiLLMOptions = { mode: 'canary', strict: true, maxLocalRenames: 2 }
antiLLM(options)
canaryEsbuild({ mode: 'canary', report: true })
const report: EncounterReport = replayCanaryProbes('function calculateSignature() { return 3; }')
void report.markerCount
inspectArtifact('/compiled/example.cjs', { root: '/compiled', confirmed: false }).then(result => {
  if (result.status === 'inspected') result.probes['full-read-4096B'].matchedCanaries.toFixed()
})

const draft: LexiconEntry = {
  id: 'n001', revision: 1, resourceId: 'r001', enabled: false,
  category: 'retention-canary', intendedLayer: 'unknown', locale: 'und',
  placements: ['function-comment'],
  targets: [{ kind: 'agent', id: 'unspecified', family: 'unspecified' }],
  review: { status: 'draft' },
  integrity: { encoding: 'utf-8', bytes: 3, sha256: 'a'.repeat(64) },
  evaluation: { status: 'not-tested', evidenceIds: [] },
}
const manifest: LexiconManifest = { schemaVersion: 1, catalogId: 'types', revision: 1, entries: [draft] }
const parsed = parseLexiconManifest(JSON.stringify(manifest))
const checked = validateLexiconManifest(parsed)
if (!checked.valid) checked.issues.forEach(issue => issue.path.toLowerCase())

// @ts-expect-error Raw-resource activation is not an exposed build mode.
antiLLM({ mode: 'raw' })
// @ts-expect-error Enabled metadata requires an approved review.
const invalid: LexiconEntry = { ...draft, enabled: true, review: { status: 'draft' } }
void invalid
