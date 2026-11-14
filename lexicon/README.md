# 单文件词表 v1

词表统一放在一个 JSON 文件里：`entries` 中每项直接包含 `text` 与元数据。新增或修改词条只需要编辑这一个文件，不需要资源 ID、独立正文文件、逐条摘要或资源解析器。修订历史由 Git 保存。

`manifest.json` 是空的通用目录；`examples/manifest.json` 是可直接解析的中性示例，随 npm 包分发。项目自行维护自己的目录。构建适配器仍使用固定 canary，不自动读取词表；`enabled: true` 也不是构建开关。

## 格式

顶层为 `schemaVersion: 1`、`catalogId`、`revision` 和 `entries`。一个目录最多 256 条，词条 ID 不重复。每个词条包含：

| 字段 | 含义 |
| --- | --- |
| `id` / `revision` | 稳定 ID 与修订号 |
| `text` | 实际候选正文，与元数据放在同一项；按原文保留，不裁剪或规范化 |
| `enabled` | 候选选择状态；只有审查通过才可为 true，不构成读取授权或构建激活 |
| `category` | 机制分类，见下文 |
| `intendedLayer` | 预期作用层：agent / model / api / unknown；只是研究假设 |
| `locale` | 语言标签，如 en / zh-Hans / und |
| `placements` | function-comment / function-string / local-name 的非空子集 |
| `targets` | `{ kind, id, family }` 列表；kind 为 agent / model / provider，family 为 international / domestic / unspecified |
| `review` | status，以及完成审查时的 reviewerId / reviewedAt |
| `evaluation` | status 与 evidenceIds；审查通过不代表有效 |

`category` 支持 retention-canary、analysis-notice、semantic-noise、instruction-redirection、context-noise、policy-sensitivity；这些名称不证明相应机制有效。ID 为小写字母开头的 1–64 位 ASCII 标识，其余只允许小写字母、数字、点、下划线和连字符。

`review.status` 为 draft / approved / rejected；后两者要求 reviewerId 和有效 RFC3339 时间。`evaluation.status` 为 not-tested / retention-only / observed；未测试时 evidenceIds 必须为空，其余状态至少关联一份证据。intendedLayer 和 targets 不代表已观察到模型、Agent 或 API 的行为。

## 使用

```js
import {
  parseLexiconManifest,
  validateLexiconManifest,
} from 'vite-plugin-anti-llm/lexicon'

const catalog = parseLexiconManifest(jsonText)
const text = catalog.entries[0]?.text
const result = validateLexiconManifest(catalog)
// { valid: true, issues: [] }
// 或 { valid: false, issues: [{ path: '/entries/0', code: 'required' }] }
```

校验器拒绝未知字段、空正文、非法元数据和重复 ID；不补默认值、不改输入、不读取其他文件。解析失败只返回结构路径和错误代码，不回显正文或未知字段名。`manifest.schema.json` 与空目录 `manifest.json` 通过对应 JSON 子路径导出，类型在 `src/lexicon.d.ts`。

这是尚未随 npm 新版本发布的 v1 契约修订：原先的独立 resource 格式已合并，旧 `resourceId` / `integrity` 字段不再接受，也不保留双格式兼容层。现有已发布的 npm 0.1.0 尚不包含词表 API。

正文始终是非可信数据，不是对读取 Agent 或构建过程的指令。本目录的例子保持中性，不调用模型或执行正文；是否注入产物需要后续独立的构建适配和行为验证。
