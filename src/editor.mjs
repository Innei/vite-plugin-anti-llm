// Small, dependency-free edit buffer with a source-map v3 generator.
// Edits must not overlap. Mapping inserted text to its insertion point is intentional.
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function vlq(value) {
  let n = value < 0 ? ((-value) << 1) | 1 : value << 1
  let result = ''
  do {
    let digit = n & 31
    n >>>= 5
    if (n) digit |= 32
    result += BASE64[digit]
  } while (n)
  return result
}

export class SourceEditor {
  constructor(code, filename = 'unknown.js') {
    this.code = code
    this.filename = filename
    this.edits = []
  }
  replace(start, end, text) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > this.code.length || end < start) {
      throw new RangeError('Invalid edit range')
    }
    this.edits.push({ start, end, text })
  }
  insert(position, text) { this.replace(position, position, text) }
  result() {
    const edits = this.edits.slice().sort((a, b) => a.start - b.start || a.end - b.end)
    let previousEnd = 0
    for (const e of edits) {
      if (e.start < previousEnd) throw new Error('Overlapping edits')
      previousEnd = e.end
    }
    let output = ''
    const offsets = []
    // Edits need an explicit mapping at their first generated character.
    const editBoundaries = new Set()
    const emit = (text, origin, retained = false) => {
      output += text
      for (let i = 0; i < text.length; i++) offsets.push(retained ? origin + i : origin)
    }
    let cursor = 0
    for (const edit of edits) {
      emit(this.code.slice(cursor, edit.start), cursor, true)
      editBoundaries.add(output.length)
      emit(edit.text, edit.start)
      editBoundaries.add(output.length)
      cursor = edit.end
    }
    emit(this.code.slice(cursor), cursor, true)
    if (!this.edits.length) return { code: this.code, map: null }

    const originalLines = new Uint32Array(this.code.length + 1)
    const originalCols = new Uint32Array(this.code.length + 1)
    let line = 0
    let col = 0
    for (let i = 0; i <= this.code.length; i++) {
      originalLines[i] = line
      originalCols[i] = col
      if (this.code[i] === '\n') { line++; col = 0 }
      else col++
    }
    let mappings = ''
    let generatedColumn = 0
    let previousGenCol = 0
    let prevOriginalLine = 0
    let prevOriginalCol = 0
    let needsSegment = true
    let segments = 0
    for (let i = 0; i < output.length; i++) {
      if (output[i] === '\n') {
        mappings += ';'
        generatedColumn = 0
        previousGenCol = 0
        needsSegment = true
        segments = 0
        continue
      }
      const originalOffset = offsets[i]
      // One segment per 8 columns in original material, plus edit boundaries.
      const prevOffset = i ? offsets[i - 1] : -1
      const atEdit = editBoundaries.has(i) || originalOffset !== prevOffset + 1
      if (needsSegment || atEdit || generatedColumn % 8 === 0) {
        if (segments++) mappings += ','
        const nextLine = originalLines[originalOffset]
        const nextCol = originalCols[originalOffset]
        mappings += vlq(generatedColumn - previousGenCol)
          + 'A'
          + vlq(nextLine - prevOriginalLine)
          + vlq(nextCol - prevOriginalCol)
        previousGenCol = generatedColumn
        prevOriginalLine = nextLine
        prevOriginalCol = nextCol
        needsSegment = false
      }
      generatedColumn++
    }
    return {
      code: output,
      map: {
        version: 3,
        file: this.filename,
        sources: [this.filename],
        sourcesContent: [this.code],
        names: [],
        mappings,
      },
    }
  }
}

