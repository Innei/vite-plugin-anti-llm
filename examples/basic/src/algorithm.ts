// Declare this macro in a .d.ts for autocomplete, or just use the JSDoc form below.
declare function __antiLLM__(id: string): void

/** @anti-llm signature.algorithm */
export function calculateSignature(input: string) {
  __antiLLM__('signature.algorithm')
  const normalized = input.trim().toLowerCase()
  const digest = Array.from(normalized).reduce((x, c) => x + c.charCodeAt(0), 0)
  return digest.toString(16)
}

