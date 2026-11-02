import assert from 'node:assert/strict'
import test from 'node:test'
import { SourceEditor } from '../src/editor.mjs'

// Independent, minimal source-map V3 decoder for the regression cases.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodeSegment(raw) {
  const result = []
  let value = 0
  let shift = 0
  for (const character of raw) {
    const digit = ALPHABET.indexOf(character)
    assert.ok(digit >= 0, 'invalid base64 digit')
    value += (digit & 31) * 2 ** shift
    if (digit & 32) shift += 5
    else {
      result.push((value & 1) ? -(value >>> 1) : (value >>> 1))
      value = 0
      shift = 0
    }
  }
  assert.equal(shift, 0, 'unterminated VLQ')
  return result
}

function originalPosition(map, generatedLine, generatedColumn) {
  let sourceIndex = 0
  let originalLine = 0
  let originalColumn = 0
  let found = null
  const lines = map.mappings.split(';')
  for (let line = 0; line <= generatedLine; line++) {
    let column = 0
    for (const segment of (lines[line] ?? '').split(',').filter(Boolean)) {
      const fields = decodeSegment(segment)
      column += fields[0]
      if (fields.length >= 4) {
        sourceIndex += fields[1]
        originalLine += fields[2]
        originalColumn += fields[3]
      }
      if (line === generatedLine && column <= generatedColumn) {
        found = fields.length >= 4
          ? { source: map.sources[sourceIndex], line: originalLine, column: originalColumn }
          : null
      }
    }
  }
  return found
}

test('injected comment maps its first character to its insertion point', () => {
  const source = 'const value = 42;'
  const comment = '/*! @preserve SYNTHETIC_CANARY */'
  const editor = new SourceEditor(source, 'fixture.js')
  editor.insert(6, comment)
  const { code, map } = editor.result()
  assert.equal(code, 'const ' + comment + 'value = 42;')
  assert.equal(map.sourcesContent[0], source)
  assert.deepEqual(originalPosition(map, 0, 6), { source: 'fixture.js', line: 0, column: 6 })
  assert.deepEqual(originalPosition(map, 0, 6 + comment.length), { source: 'fixture.js', line: 0, column: 6 })
})

test('renamed identifiers and multiline insertions preserve mapping boundaries', () => {
  const source = 'const value = 42;\nconsole.log(value);'
  const editor = new SourceEditor(source, 'fixture.js')
  editor.replace(6, 11, 'value__ai_test_long')
  editor.insert(source.lastIndexOf('value'), '/* synthetic\ncomment */')
  const { code, map } = editor.result()
  assert.deepEqual(originalPosition(map, 0, 6), { source: 'fixture.js', line: 0, column: 6 })
  assert.deepEqual(originalPosition(map, 0, 'const value__ai_test_long'.length), { source: 'fixture.js', line: 0, column: 11 })
  const lines = code.split('\n')
  assert.equal(lines.length, 3)
  assert.deepEqual(originalPosition(map, 1, lines[1].indexOf('/* synthetic')), { source: 'fixture.js', line: 1, column: 12 })
  assert.deepEqual(originalPosition(map, 2, lines[2].indexOf('value')), { source: 'fixture.js', line: 1, column: 12 })
})
