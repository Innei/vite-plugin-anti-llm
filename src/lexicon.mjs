import { createRequire } from 'node:module'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

export const LEXICON_SCHEMA_VERSION = 1
const schema = createRequire(import.meta.url)('../lexicon/manifest.schema.json')
const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false })
addFormats(ajv, ['date-time'])
const validate = ajv.compile(schema)

/** Metadata only: never resolves resource IDs or opens resource files. */
export function validateLexiconManifest(value) {
  if (!validate(value)) return {
    valid: false,
    issues: (validate.errors ?? []).map(error => ({ path: error.instancePath || '/', code: error.keyword })),
  }
  const entries = new Set()
  const resources = new Map()
  for (const [index, entry] of value.entries.entries()) {
    if (entries.has(entry.id)) return { valid: false, issues: [{ path: `/entries/${index}/id`, code: 'duplicate-entry-id' }] }
    entries.add(entry.id)
    const integrity = `${entry.integrity.bytes}:${entry.integrity.sha256}`
    if (resources.has(entry.resourceId) && resources.get(entry.resourceId) !== integrity) {
      return { valid: false, issues: [{ path: `/entries/${index}/integrity`, code: 'conflicting-resource-integrity' }] }
    }
    resources.set(entry.resourceId, integrity)
  }
  return { valid: true, issues: [] }
}

export function parseLexiconManifest(source) {
  let value
  try {
    if (typeof source !== 'string') throw new Error()
    value = JSON.parse(source)
  } catch { throw new Error('Invalid lexicon JSON') }
  const result = validateLexiconManifest(value)
  if (!result.valid) {
    const issue = result.issues[0]
    throw new Error(`Invalid lexicon manifest: ${issue.code} at ${issue.path}`)
  }
  return value
}
