import ts from 'typescript'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { SourceEditor } from './editor.mjs'

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
    this.options = { mode: 'canary', maxLocalRenames: 2, ...options }
    if (!Number.isInteger(this.options.maxLocalRenames) || this.options.maxLocalRenames < 0 || this.options.maxLocalRenames > 8) {
      throw new Error('Invalid canary option: maxLocalRenames')
    }
    this.root = process.cwd()
    this.reset()
  }

  reset() {
    this.targets = new Map()
    this.reserved = new Set()
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
}
