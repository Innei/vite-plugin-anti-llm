import ts from 'typescript'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { SourceEditor } from './editor.mjs'

export const CANARY_API_VERSION = 1

export const normalizePath = value => value.replaceAll('\\', '/').replace(/\?.*$/, '')
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12)
const isFunction = node => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)

function serviceFor(filename, code) {
  return ts.createLanguageService({
    getScriptFileNames: () => [filename],
    getScriptVersion: () => '0',
    getScriptSnapshot: name => name === filename ? ts.ScriptSnapshot.fromString(code)
      : ts.sys.fileExists(name) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(name)) : undefined,
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({ allowJs: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest }),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  }, ts.createDocumentRegistry())
}

export class CanaryCore {
  constructor(options = {}) {
    if (options.customProfiles !== undefined || options.profiles !== undefined || options.anchors !== undefined) {
      throw new Error('Canary mode does not support custom content or profiles')
    }
    this.options = {
      mode: 'canary', maxLocalRenames: 2, strict: true,
      injectComments: true, injectStrings: true,
      maxFunctionsPerChunk: 20, maxBytesPerFunction: 256, maxBytesPerChunk: 8192,
      ...options,
    }
    if (!Number.isInteger(this.options.maxLocalRenames) || this.options.maxLocalRenames < 0 || this.options.maxLocalRenames > 8) {
      throw new Error('Invalid canary option: maxLocalRenames')
    }
    for (const key of ['maxFunctionsPerChunk', 'maxBytesPerFunction', 'maxBytesPerChunk']) {
      if (!Number.isSafeInteger(this.options[key]) || this.options[key] < 0) throw new Error(`Invalid canary option: ${key}`)
    }
    for (const key of ['strict', 'injectComments', 'injectStrings']) {
      if (typeof this.options[key] !== 'boolean') throw new Error(`Invalid canary option: ${key}`)
    }
    this.root = process.cwd()
    this.reset()
  }

  reset() {
    this.targets = new Map()
    this.reserved = new Set()
    this.output = new Map()
  }

  transform(code, id) {
    const filename = normalizePath(id)
    if (!/\.[cm]?[jt]sx?$/.test(filename) || /\/node_modules\//.test(filename)) return null
    this.targets.delete(filename)
    const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true,
      /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : /\.jsx?$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
    const selected = []
    const removed = new Map()
    const visit = node => {
      if (isFunction(node) && node.body) {
        const comments = ts.getLeadingCommentRanges(code, node.getFullStart()) ?? []
        let targetId
        for (const comment of comments) {
          const text = code.slice(comment.pos, comment.end)
          const marker = text.match(/@anti-llm(?:\s+([\w.:-]+))?/)
          if (marker) {
            targetId = marker[1] || 'protected'
            removed.set(comment.pos, comment.end)
          }
        }
        if (ts.isBlock(node.body)) {
          for (const statement of node.body.statements) {
            if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue
            const call = statement.expression
            if (!ts.isIdentifier(call.expression) || call.expression.text !== '__antiLLM__') continue
            if (call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0])) throw new Error('Invalid compile-time canary macro')
            targetId = call.arguments[0].text
            removed.set(statement.getStart(source), statement.end)
          }
        }
        if (targetId) selected.push({ node, targetId })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!selected.length) return null
    const editor = new SourceEditor(code, filename)
    const edits = new Map()
    const records = []
    let service
    try {
      if (this.options.mode !== 'off' && this.options.maxLocalRenames) service = serviceFor(filename, code)
      for (const { node, targetId } of selected) {
        if (this.options.mode === 'off') continue
        const opaque = hash(`${normalizePath(path.relative(this.root, filename))}:${targetId}:${node.pos}`)
        const locals = []
        let dynamicScope = false
        const inspect = child => {
          if (ts.isWithStatement(child) || ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'eval') dynamicScope = true
          ts.forEachChild(child, inspect)
        }
        inspect(node)
        if (dynamicScope) throw new Error(`Unsupported dynamic scope in canary target ${opaque}`)
        const collect = child => {
          if (isFunction(child)) return
          if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) locals.push(child.name)
          ts.forEachChild(child, collect)
        }
        ts.forEachChild(node.body, collect)
        const bindings = []
        for (const identifier of locals.slice(0, this.options.maxLocalRenames)) {
          let renamed = `__al_${hash(`${opaque}:${identifier.pos}`)}`
          while (code.includes(renamed)) renamed += '_'
          const uses = service?.findRenameLocations(filename, identifier.getStart(source), false, false, true) ?? []
          if (!uses.length) continue
          for (const use of uses) {
            if (normalizePath(use.fileName) !== filename) continue
            const { start, length } = use.textSpan
            if (code.slice(start, start + length) !== identifier.text) continue
            edits.set(start, { end: start + length, text: `${use.prefixText ?? ''}${renamed}${use.suffixText ?? ''}` })
          }
          bindings.push(renamed)
        }
        records.push({ id: opaque, bindings })
      }
    } finally { service?.dispose() }
    this.targets.set(filename, records)
    this.reserved = new Set([...this.targets.values()].flatMap(records => records.flatMap(record => record.bindings)))
    for (const [start, end] of removed) editor.replace(start, end, '')
    for (const [start, edit] of edits) {
      if (![...removed].some(([from, to]) => start >= from && start < to)) editor.replace(start, edit.end, edit.text)
    }
    return editor.result()
  }

  finalize(code, filename, modules = [...this.targets.keys()], output = this.output, resolveIdentifier) {
    if (this.options.mode === 'off') return null
    const records = [...new Set(modules.map(normalizePath))].flatMap(id => this.targets.get(id) ?? [])
    if (!records.length) return null
    const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    if (source.parseDiagnostics.length) throw new Error('Invalid JavaScript before canary insertion')
    const declarations = new Map()
    const mappingPoints = new Set()
    const visit = node => {
      const resolve = identifier => this.reserved.has(identifier.text) ? identifier.text
        : resolveIdentifier?.(identifier.getStart(source), source)
      if (ts.isIdentifier(node) && resolve(node)) mappingPoints.add(node.getStart(source))
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && resolve(node.name)) {
        let parent = node.parent
        while (parent && !isFunction(parent)) parent = parent.parent
        if (parent?.body && ts.isBlock(parent.body)) declarations.set(resolve(node.name), parent.body)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    const editor = new SourceEditor(code, filename)
    // Preserve exact upstream symbol mapping points across the inserted text.
    for (const position of mappingPoints) editor.insert(position, '')
    const entries = []
    let bytes = 0
    for (const record of records) {
      const entry = { id: hash(`${filename}:${record.id}`), sourceId: record.id, located: false, comments: 0, strings: 0, bytes: 0 }
      const body = record.bindings.map(name => declarations.get(name)).find(Boolean)
      const fail = reason => {
        if (this.options.strict) throw new Error(`Canary ${reason} for target ${entry.id}`)
      }
      if (!body) fail('location missing')
      else if (entries.filter(item => item.located).length >= this.options.maxFunctionsPerChunk) fail('budget exceeded')
      else {
        const comment = this.options.injectComments ? `/*! @preserve AL_CANARY_${entry.id}_C */` : ''
        const literal = this.options.injectStrings ? `void "AL_CANARY_${entry.id}_S";` : ''
        const text = comment + literal
        const size = Buffer.byteLength(text)
        if (size > this.options.maxBytesPerFunction || bytes + size > this.options.maxBytesPerChunk) fail('budget exceeded')
        else {
          // Preserve the full directive prologue, including unknown directives.
          let position = body.getStart(source) + 1
          for (const statement of body.statements) {
            if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
            position = statement.end
          }
          editor.insert(position, text)
          Object.assign(entry, { located: true, comments: Number(this.options.injectComments), strings: Number(this.options.injectStrings), bytes: size })
          bytes += size
        }
      }
      entries.push(entry)
    }
    const result = editor.result()
    if (ts.createSourceFile(filename, result.code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length) {
      throw new Error('Invalid JavaScript after canary insertion')
    }
    output.set(filename, entries)
    return result
  }

  verify(chunks, output = this.output) {
    const functions = []
    for (const chunk of chunks) {
      const source = ts.createSourceFile(chunk.fileName, chunk.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      if (source.parseDiagnostics.length) throw new Error('Invalid JavaScript in final canary output')
      const visit = node => {
        if (isFunction(node) && node.body && ts.isBlock(node.body)) {
          const comments = new Set()
          const strings = new Set()
          for (const statement of node.body.statements) {
            const ranges = [
              ...(ts.getLeadingCommentRanges(chunk.code, statement.pos) ?? []),
              ...(ts.getTrailingCommentRanges(chunk.code, statement.pos) ?? []),
            ]
            for (const range of ranges) {
              const match = chunk.code.slice(range.pos, range.end).match(/^\/\*! @preserve AL_CANARY_([a-f0-9]{12})_C \*\/$/)
              if (match) comments.add(match[1])
            }
            if (ts.isExpressionStatement(statement) && ts.isVoidExpression(statement.expression)
              && ts.isStringLiteral(statement.expression.expression)) {
              const match = statement.expression.expression.text.match(/^AL_CANARY_([a-f0-9]{12})_S$/)
              if (match) strings.add(match[1])
            }
          }
          functions.push({ comments, strings })
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    const entries = [...output.values()].flat()
    let commentsRetained = 0
    let stringsRetained = 0
    for (const entry of entries) {
      const retained = functions.some(item => (!entry.comments || item.comments.has(entry.id))
        && (!entry.strings || item.strings.has(entry.id)))
      commentsRetained += Number(entry.comments > 0 && retained)
      stringsRetained += Number(entry.strings > 0 && retained)
    }
    const report = this.report(output)
    Object.assign(report, { commentsRetained, stringsRetained })
    if (this.options.strict && report.targetsMissed) throw new Error('Canary location missing in final output')
    if (this.options.strict && (commentsRetained !== report.commentsInserted || stringsRetained !== report.stringsInserted)) {
      throw new Error('Canary retention missing in final output')
    }
    return report
  }

  report(output = this.output) {
    const source = [...this.targets.values()].flat()
    const entries = [...output.values()].flat()
    return {
      schemaVersion: 1, mode: this.options.mode,
      sourceMarked: source.length,
      sourceRenamed: source.reduce((sum, record) => sum + record.bindings.length, 0),
      targetsLocated: entries.filter(entry => entry.located).length,
      targetsMissed: entries.filter(entry => !entry.located).length
        + source.filter(record => !entries.some(entry => entry.sourceId === record.id)).length,
      commentsInserted: entries.reduce((sum, entry) => sum + entry.comments, 0),
      stringsInserted: entries.reduce((sum, entry) => sum + entry.strings, 0),
      injectedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      caveat: 'Local build retention only; no model service called, no refusal or reconstruction efficacy measured.',
    }
  }
}
