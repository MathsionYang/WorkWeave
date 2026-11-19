# 织迹（WorkWeave）WorkBuddy 测试手册

> 适用版本：0.1.0  
> 测试方式：WorkBuddy 通过 MCP stdio 启动织迹服务，模型按 Skill 模板调用织迹工具  
> 测试目标：验证“探测 → 采集 → 归类 → 事实抽取 → 证据包 → 宿主总结 → 校验 → 导出 → 回查/待确认”的完整链路

---

## 1. 测试范围

本手册覆盖以下能力：

| 编号 | 能力 | 对应工具 |
|---|---|---|
| T01 | 工具发现与协议握手 | `initialize` / `tools/list` |
| T02 | 来源探测 | `ww_source_probe` |
| T03 | 按日采集 | `ww_source_ingest` |
| T04 | 项目与活动类别归类 | `ww_work_classify` |
| T05 | 测试与提交事实抽取 | `ww_fact_extract` |
| T06 | 结构化证据包 | `ww_evidence_package` |
| T07 | Skill 模板获取 | `ww_skill_template_get` |
| T08 | 宿主总结九维校验 | `ww_summary_validate` |
| T09 | 报告导出（Markdown/JSON/HTML/PDF） | `ww_report_export` |
| T10 | 证据回查 | `ww_evidence_resolve` |
| T11 | 待确认项查询/确认/忽略 | `ww_pending_manage` |
| T12 | 跨工具统一视图与来源分布 | 报告/团队视图 |
| T13 | Claude 部分可用 | `ww_source_probe` / 报告完整性标记 |
| T14 | 幂等与错误场景 | `callId` / 统一错误码 |
| T15 | 跨来源精确去重与原文回查 | `ww_sessions_search` / `ww_session_read` |

---

## 2. 前置条件

### 2.1 环境要求

- Node.js **24 或以上**
- npm 11 或以上
- WorkBuddy 已安装，且支持配置 MCP Server（stdio）
- 本机至少有一类织迹支持的记录来源：
  - Codex：`%USERPROFILE%\.codex`
  - WorkBuddy：`%USERPROFILE%\.workbuddy`
  - dsh：`%USERPROFILE%\.dsh`
  - Claude：`%USERPROFILE%\.claude`（当前仅降级探测，不承诺解析）

### 2.2 准备测试数据

建议直接使用“今天”或最近有会话记录的日期。为了确保有数据：

1. 打开 WorkBuddy，正常进行 2～3 轮对话。
2. 如使用 Codex，运行一次 Codex 会话。
3. 记录你要测试的日期，例如 `2026-11-04`。

可通过以下命令确认本机记录是否被识别：

```powershell
cd D:\项目\WorkWeave
node packages\cli\dist\main.js probe --platform=win32 --home=C:\Users\Administrator
```

预期输出为制表符分隔的四行，分别对应 `codex`、`claude`、`workbuddy`、`dsh`：

```text
codex    discovered    complete    C:\Users\Administrator\.codex    -
claude   not-found     complete    -                                -
workbuddy discovered   complete    C:\Users\Administrator\.workbuddy -
dsh      discovered    complete    C:\Users\Administrator\.dsh      -
```

> `not-found` 表示该来源没有记录或路径不存在，不是程序错误。  
> `partially-available` 表示记录存在但不完整（例如只有 Claude Code，没有 Claude Desktop 普通聊天）。

---

## 3. 构建与自检

在项目根目录执行：

```powershell
cd D:\项目\WorkWeave
npm ci
npm run build
npm run guard:no-model
```

预期：

- `npm ci`：依赖安装成功
- `npm run build`：无 TypeScript 错误
- `npm run guard:no-model`：输出 `guard:no-model passed`

如只改动了局部代码，可执行：

```powershell
npm run lint
```

---

## 4. 配置 WorkBuddy 的 MCP Server

> WorkBuddy 不同版本的 MCP 配置界面可能不同。以下为通用配置字段；若 WorkBuddy 使用图形界面，请把同样的 `command`、`args`、`env` 填入对应输入框。

### 4.1 配置 JSON 示例

```json
{
  "mcpServers": {
    "workweave": {
      "command": "node",
      "args": [
        "D:\\项目\\WorkWeave\\packages\\mcp\\dist\\main.js"
      ],
      "env": {
        "WORKWEAVE_HOME": "C:\\Users\\Administrator",
        "WORKWEAVE_PLATFORM": "win32",
        "WORKWEAVE_HOST_ID": "workbuddy",
        "WORKWEAVE_TOKEN": "local-token"
      }
    }
  }
}
```

### 4.2 环境变量说明

| 变量 | 必填 | 说明 |
|---|---|---|
| `WORKWEAVE_HOME` | 建议 | 用户主目录，织迹据此探测 `.codex`、`.workbuddy`、`.dsh`、`.claude` |
| `WORKWEAVE_PLATFORM` | 建议 | `win32` / `darwin` / `linux` |
| `WORKWEAVE_HOST_ID` | 否 | 默认 `workbuddy` |
| `WORKWEAVE_TOKEN` | 否 | 默认 `local-token`，仅用于本地网关校验 |
| `WORKWEAVE_DB_PATH` | 否 | SQLite 文件路径；默认使用用户目录下的 `.workweave/workweave.sqlite`；自定义时父目录必须已存在 |
| `WORKWEAVE_PDF_FONT` | 否 | PDF 中文字体路径；未设置时自动探测系统字体 |

### 4.3 启动自检

保存配置后重启 WorkBuddy，或刷新 MCP Server。

可用 PowerShell 做一次协议握手自检。先进入项目根目录，或直接使用构建产物的绝对路径：

```powershell
# 方式一：先进入项目根目录
cd D:\项目\WorkWeave
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' | node .\packages\mcp\dist\main.js

# 方式二：不切换目录，直接使用绝对路径
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' | node "D:\项目\WorkWeave\packages\mcp\dist\main.js"
```

> 如果报错 `Cannot find module 'C:\Users\<用户>\packages\mcp\dist\main.js'`，说明当前 PowerShell 目录不是项目根目录。相对路径 `packages\mcp\dist\main.js` 会按当前目录解析，因此必须 `cd D:\项目\WorkWeave`，或者使用绝对路径。

预期返回类似：

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"workweave","version":"0.1.0"}}}
```

---

## 5. 测试用例

### T01 工具发现

**WorkBuddy 输入（任选其一）**

- “列出织迹可用的工具”
- “请调用织迹的 tools/list”

**预期结果**

- 返回 **13 个工具**：
  `ww_source_probe`、`ww_source_ingest`、`ww_sessions_list`、`ww_session_read`、`ww_sessions_search`、`ww_work_classify`、`ww_fact_extract`、`ww_evidence_package`、`ww_skill_template_get`、`ww_summary_validate`、`ww_report_export`、`ww_pending_manage`、`ww_evidence_resolve`
- 每个工具都有 `inputSchema`
- `ww_summary_validate` 的 `required` 中包含 `sections`

**失败判定**

- 工具数量不对
- `initialize` 无响应
- WorkBuddy 提示 MCP Server 启动失败

---

### T02 来源探测

**WorkBuddy 输入**

```text
调用 ww_source_probe，参数 source=codex
```

或自然语言：

```text
织迹，探测我本机的 Codex 记录
```

**预期结果**

返回数组，元素包含：

```json
{
  "source": "codex",
  "status": "discovered",
  "adoptedPath": "C:\\Users\\Administrator\\.codex",
  "completeness": { "status": "complete", "gaps": [], "undetermined": false },
  "warnings": [],
  "probedAt": "2026-11-04T...",
  "fromCache": false
}
```

**接着测试全部来源**

```text
调用 ww_source_probe（不传 source）
```

预期返回 4 项；其中 `claude` 若只有 `projects/` 目录，应返回：

```json
{
  "status": "partially-available",
  "completeness": {
    "status": "possibly-incomplete",
    "gaps": [{ "type": "source-type-missing", "source": "claude", "scope": "claude-desktop" }]
  },
  "warnings": ["E-SRC-003"]
}
```

---

### T03 按日/区间采集与断点续采

**单日采集（兼容接口）**

```text
调用 ww_source_ingest，参数 day=2026-11-19，source=codex，resume=true
```

也可以通过 CLI 采集：

```powershell
node packages\cli\dist\main.js ingest --day=2026-11-19 --source=codex --resume
```

**区间采集**

`dayFrom` 与 `dayTo` 必须同时提供，按闭区间处理（首尾日期都包含）；不能与 `day` 同时传入。日期非法、只传一个边界或 `dayFrom > dayTo` 时应返回 `E-MCP-003`。

```text
调用 ww_source_ingest，参数 dayFrom=2026-11-01，dayTo=2026-11-19，source=codex，resume=true
```

对应 CLI：

```powershell
node packages\cli\dist\main.js ingest --day-from=2026-11-01 --day-to=2026-11-19 --source=codex --resume
```

**检查点**

- 返回 `day` 为单日或 `YYYY-MM-DD..YYYY-MM-DD`，并包含 `sessionCount`、`messageCount`、`dataVersion`、`warnings`、`skippedSources`、`completedFiles`、`failedFiles`、`resumedFiles`。
- 区间首尾日期内的会话都被采集；跨午夜的会话按会话开始日期归入区间。
- `resume=true` 会根据持久化 checkpoint 跳过内容指纹未变化的文件；`resumedFiles > 0` 表示本次有文件从断点续过。
- 有单文件失败时其他文件继续处理；`failedFiles` 与实际失败文件数一致，可再次调用续采。
- 同一范围重复采集后，调用 `ww_sessions_list` 核对，会话和消息数不应增长，`dataVersion` 应稳定。
- 未配置来源出现在 `skippedSources` 属于预期。

**WorkBuddy 实测基线（2026-11-19，Codex）**

```text
扫描处理文件：244
失败文件：0
入库会话：2
入库消息：157
会话 A：115 条消息，10:31–14:58
会话 B：42 条消息，13:55–13:56
```

首次查询列表返回 0 条是因为尚未建立索引；执行采集后列表能够返回上述两条会话。复测时应先调用 `ww_source_ingest`，再调用 `ww_sessions_list`，避免把未采集误判为读取失败。

---

### T03-A 日期区间、续采与 MCP 版本确认

用多个日期做区间采集，验证闭区间及断点续采。首次运行后再次使用相同范围和来源调用，检查返回的 `completedFiles`、`failedFiles`、`resumedFiles`；应看到已完成且内容未变的文件被跳过，数据不重复增加。

```text
ww_source_ingest({"dayFrom":"2026-11-01","dayTo":"2026-11-19","source":"codex","resume":true})
```

对应 CLI：

```powershell
node packages\cli\dist\main.js ingest --day-from=2026-11-01 --day-to=2026-11-19 --source=codex --resume
```

确认 WorkBuddy 连接新版 MCP：

1. 调用 `tools/list`，确认工具清单共 13 个，包含 `ww_sessions_list`、`ww_session_read`、`ww_sessions_search`。
2. 确认 `ww_source_ingest` schema 同时包含兼容参数 `day`、区间参数 `dayFrom`/`dayTo` 和 `resume`。
3. 调用区间采集后检查 `completedFiles`、`failedFiles`、`resumedFiles`；再用 `ww_sessions_list` 查询区间内会话。
4. 若缺少工具或参数，重启 MCP 进程，并确认启动命令指向当前工作区的 `packages/mcp/dist/main.js`。配置 `WORKWEAVE_DB_PATH` 可固定会话与 checkpoint 数据库位置，并先创建其父目录。

### T04 项目与活动类别归类

**WorkBuddy 输入**

```text
调用 ww_work_classify，参数 day=2026-11-04
```

**预期结果**

返回数组，每个会话包含：

```json
{
  "sessionId": "...",
  "projectId": "project-a 或 cross-project 或 unassigned",
  "category": "coding / debugging / testing / research / pure-conversation ...",
  "pureConversationKind": "knowledge-qa 等（仅纯对话）",
  "basis": "structured-feature / configured-rule / manual",
  "confidence": 0.7,
  "locked": false,
  "pending": false,
  "reasons": ["..."]
}
```

**检查点**

- 同一项目下多来源会话应归到同一个 `projectId`，而不是按来源拆分
- 纯对话会话 `category = pure-conversation`
- 无项目线索时 `projectId = unassigned`

---

### T05 测试与提交事实抽取

**WorkBuddy 输入**

```text
调用 ww_fact_extract，参数 day=2026-11-04
```

**预期结果**

```json
{
  "day": "2026-11-04",
  "tests": [
    {
      "sessionId": "...",
      "projectId": "unassigned",
      "type": "jest",
      "command": "npm test",
      "status": "failed / passed / blocked / not-run",
      "failureReason": "...",
      "evidenceIds": []
    }
  ],
  "submissions": [
    { "dedupKey": "commit:...", "kind": "commit", "sessionId": "..." }
  ]
}
```

**检查点**

- 测试状态只能是四态之一
- 截断输出不得判 `passed`
- 提交与回退按 `dedupKey` 去重

---

### T06 结构化证据包

**WorkBuddy 输入**

```text
调用 ww_evidence_package，参数 day=2026-11-04
```

**预期结果**

```json
{
  "packageId": "24 位十六进制字符串",
  "dataVersion": "...",
  "range": { "from": "2026-11-04", "to": "2026-11-04" },
  "sources": ["codex", "workbuddy"],
  "completeness": { "status": "complete 或 possibly-incomplete", "gaps": [], "undetermined": false },
  "categories": [
    { "key": "sessions", "present": true, "items": [] },
    { "key": "messages", "present": true, "items": [] },
    { "key": "projects", "present": true, "items": [] },
    { "key": "activities", "present": true, "items": [] },
    { "key": "tests", "present": false, "reason": "range has no test results", "items": [] },
    { "key": "submissions", "present": true, "items": [] },
    { "key": "adoption", "present": true, "items": [] },
    { "key": "research", "present": true, "items": [] },
    { "key": "pending", "present": false, "reason": "...", "items": [] }
  ],
  "meta": {
    "entryCount": 2000,
    "serializedBytes": 123456,
    "trimmed": true,
    "removedCount": 48000,
    "redactionHits": 0,
    "excludedBlockCount": 0
  }
}
```

**检查点**

- `categories` 必须正好 9 类
- 空类别必须 `present=false` 且带 `reason`，不能省略
- 不应包含完整原始对话；消息类只含脱敏后的最小片段
- `packageId` 在相同数据版本与范围下可复用

---

### T07 Skill 模板

**WorkBuddy 输入**

```text
调用 ww_skill_template_get
```

**预期结果**

```json
{
  "templateVersion": "1.0.0",
  "totalMaxChars": 4000,
  "sections": [
    { "key": "completions", "title": "今日完成", "required": true, "maxChars": 800, "minEvidenceRefs": 0 },
    { "key": "problems", "title": "解决的问题", "required": true, "maxChars": 800, "minEvidenceRefs": 0 },
    { "key": "tests", "title": "测试结果", "required": true, "maxChars": 800, "minEvidenceRefs": 1 },
    { "key": "optimizations", "title": "待优化项", "required": true, "maxChars": 800, "minEvidenceRefs": 0 },
    { "key": "adoption", "title": "AI 协作与采纳", "required": true, "maxChars": 800, "minEvidenceRefs": 1 },
    { "key": "research", "title": "今日调研", "required": true, "maxChars": 800, "minEvidenceRefs": 1 }
  ]
}
```

---

### T08 宿主总结九维校验

先记录 T06 返回的 `packageId`。准备一个六部分 `sections` 对象，`evidenceIds` 使用证据包中实际存在的 `id`，例如 `session:codex:xxx`。

**WorkBuddy 输入**

```text
调用 ww_summary_validate，参数：
packageId = <T06 的 packageId>
templateVersion = 1.0.0
sections = {
  "completions": { "text": "完成登录修复", "evidenceIds": ["session:codex:xxx"] },
  "problems": { "text": "根因待确认", "evidenceIds": [] },
  "tests": { "text": "测试失败 1 项", "evidenceIds": ["test:xxx:npx jest"] },
  "optimizations": { "text": "无", "evidenceIds": [] },
  "adoption": { "text": "采纳度 50%（分子 1 / 分母 2）", "evidenceIds": ["adoption:xxx"] },
  "research": { "text": "调研方案对比，结论已形成", "evidenceIds": ["research:xxx:0"] }
}
```

**预期结果**

```json
{
  "passed": true,
  "violations": []
}
```

**负向校验（必须失败）**

把 `sections` 改为 `{}`，应返回：

```json
{
  "passed": false,
  "violations": [
    { "code": "section-missing", "section": "completions", "message": "..." }
  ]
}
```

其他负向用例：

- `evidenceIds` 使用不存在的 ID → `unknown-evidence`
- `text` 中包含 `sk-...` 等敏感串 → `sensitive-content`
- `text` 中包含“AI 总结”“绩效排名”等 → `forbidden-phrase`
- 单个章节超过 800 字 → `section-too-long`
- 项目被写成“项目 A（Codex）” → `source-split`
- 失败测试被写成“测试通过” → `reference-inconsistent`

---

### T09 报告导出（HTML 主报告 + 图表）

> WorkBuddy 调用 `ww_report_export` 时，**不指定 `format` 默认输出 HTML**。  
> HTML 为自包含离线文件：内联 CSS + SVG，不依赖 CDN，可直接双击打开。  
> 如果 WorkBuddy 直接在聊天里输出 Markdown，说明它**没有调用导出工具**；请明确说“调用 `ww_report_export`，out=...html”，而不是只说“生成总结”。

#### HTML（默认，推荐）

```text
调用 ww_report_export，参数：
day = 2026-11-04
out = C:\Users\Administrator\Desktop\workweave-daily.html
format = html
```

`format` 也可省略，效果相同。

**预期结果**

```json
{ "path": "C:\\Users\\Administrator\\Desktop\\workweave-daily.html", "dataVersion": "..." }
```

打开 HTML 后逐项检查：

- 正文结构固定为「本期结论」+ 三类章节，顺序为「1. 工作进展」「2. 问题与质量」「3. 调研与行动」。
- 「工作进展」固定包含「1.1 日度分布」「1.2 按项目归集」；日度分布展示日期、会话、项目、测试、失败数量。
- 「问题与质量」固定包含「2.1 解决的问题」「2.2 测试结果」，测试状态按通过/失败/阻塞/未执行统计。
- 「调研与行动」固定包含「3.1 本期调研」「3.2 待优化项」。
- 空类别仍显示对应章节与统一的“未检测到…”提示，不省略章节、不使用“未提供”占位。
- 项目名应业务可读，不应是时间戳、纯会话 ID 或 `SATBin64`。
- 系统提示、`environment_context`、工具脚手架不得出现在正文。
- 页面源码中不应出现外部 `http://` / `https://` / CDN 依赖。
- 正文不得出现「AI 协作与采纳」「数据覆盖边界」「证据索引」独立章节。

**实测基线（2026-11-04）**

```text
sessionCount = 9
codex = 4 个会话
workbuddy = 5 个会话
dataVersion = 24d31f52e28c40be
skippedSources = ["claude"]
```

#### Markdown（可选，仅显式指定 format=markdown）

```text
调用 ww_report_export，参数：
day = 2026-11-04
out = C:\Users\Administrator\Desktop\workweave-daily.md
format = markdown
```

检查与 HTML 相同的固定章节顺序；Markdown 为纯文本格式，不包含图表。

#### 周报区间

`ww_report_export` 支持闭区间参数 `dayFrom` 与 `dayTo`，生成周报；两端日期均包含：

```text
调用 ww_report_export，参数：
dayFrom = 2026-11-13
dayTo = 2026-11-19
out = C:\Users\Administrator\Desktop\workweave-weekly.html
format = html
```

周报与日报使用同一章节及顺序，只是“日度分布”包含区间内每天的数据，标题显示完整日期范围。`day` 与 `dayFrom`/`dayTo` 不可同时使用；区间缺少任一边界或起始日期晚于结束日期时应返回 `E-MCP-003`。

#### JSON

```text
调用 ww_report_export，参数：
day = 2026-11-04
out = C:\Users\Administrator\Desktop\workweave-daily.json
format = json
```

检查文件可由 JSON 解析器解析，字段与 HTML 使用同一 `dataVersion`。

#### PDF

```text
调用 ww_report_export，参数：
day = 2026-11-04
out = C:\Users\Administrator\Desktop\workweave-daily.pdf
format = pdf
```

检查：

- 文件头为 `%PDF-`
- 中文正常显示
- 若无中文字体，工具返回 `E-RPT-001`，不会生成乱码 PDF

---

### T10 证据回查

从 T06 的 `sessions` 类别中取一个 `id`，例如 `session:codex:xxx`。

```text
调用 ww_evidence_resolve，参数：
packageId = <T06 的 packageId>
evidenceId = session:codex:xxx
```

**预期结果**

返回该证据条目，包含 `id`、`kind`、`ref` 或 `meta`。

**负向用例**

使用不存在的 `evidenceId` → `E-PKG-002`。

---

### T11 待确认项

#### 查询

```text
调用 ww_pending_manage，参数：
day = 2026-11-04
action = query
```

**预期结果**

返回数组，元素包含：

```json
{ "id": 1, "source": "claude", "type": "record-integrity", "scope": "source-type-missing:claude-desktop", "status": "pending" }
```

#### 确认

```text
调用 ww_pending_manage，参数：
day = 2026-11-04
action = confirm
id = 1
```

预期该条 `status` 变为 `confirmed`。

#### 忽略

把 `action` 改为 `ignore`，预期变为 `ignored`。

> SQLite 默认持久化会话和 checkpoint 到 `.workweave/workweave.sqlite`；证据包的 `packageId` 仅当前进程有效。

---

### T12 跨工具统一视图

**准备**

让同一个项目目录同时产生 Codex 与 WorkBuddy 记录，例如工作目录都为 `D:\项目\CheckMCP\Doc`。

**执行**

```text
调用 ww_report_export，参数 day=2026-11-04，out=C:\Users\Administrator\Desktop\workweave-2026-11-04.html，format=html
```

**检查点**

- 报告中该项目只出现**一个**项目章节
- 不应出现“项目 A（Codex）”“项目 A（WorkBuddy）”这种按来源拆分的章节
- 项目来源分布同时列出来源、会话数、消息数、占比
- 占比合计因四舍五入不等于 100% 时，报告应注明差异

---

### T13 Claude 部分可用

**准备**

保留 `%USERPROFILE%\.claude\projects`，但不要提供 Claude Desktop 普通聊天样本。

**执行**

```text
调用 ww_source_probe（不传 source）
```

**预期**

- Claude 状态为 `partially-available`
- `warnings` 包含 `E-SRC-003`
- `completeness.gaps` 包含 `source-type-missing`
- 报告正文继续使用固定模板，不增加「数据覆盖边界」章节；采集完整性通过探测与待确认项工具核查。

---

### T14 幂等与错误场景

#### 幂等

同一个 MCP `id` 连续调用两次 `ww_pending_manage`，服务端使用相同 `callId`，第二次应返回第一次结果，不重复执行。

#### 错误码

| 场景 | 预期 |
|---|---|
| 未知工具 | `E-MCP-005` |
| 缺少必填参数（如 `day`） | `E-MCP-003` |
| `sections` 不是对象 | `E-MCP-003` |
| 未知 `packageId` | `E-PKG-001` |
| 未知 `evidenceId` | `E-PKG-002` |
| PDF 无中文字体 | `E-RPT-001` |

---

### T15 跨来源精确去重与原文回查

**准备**

在同一项目中，分别通过两个来源记录完全相同的用户提示（仅空格、换行或 Unicode 规范化差异可不同），并确保两条消息时间相差不超过 10 分钟。保留两个来源各自的会话 ID 与消息 ID。

**执行**

```text
调用 ww_sessions_search，参数 query=<提示中的唯一短语>，dayFrom=2026-11-19，dayTo=2026-11-19
```

**检查点**

- 搜索结果将同项目、10 分钟内完全相同的跨来源用户提示折叠为一条。
- 折叠条目 `sources` 保留每个原始引用，结构为 `[{"sourceTool":"codex","sessionId":"...","messageId":"..."}, ...]`；去重只影响搜索展示，不删除或改写原会话。
- 不同项目、超过 10 分钟、文本不同或非用户消息不得错误合并。
- 分别使用每个 `sourceTool` 与 `sessionId` 调用 `ww_session_read`，确认两份原始消息仍可独立读取。

---

## 6. 预期结果总表

| 检查项 | 通过标准 |
|---|---|
| MCP 握手 | `initialize` 返回 `protocolVersion` 与 `serverInfo` |
| 工具数量 | 13 个 |
| 探测 | 已存在的来源返回 `discovered`；Claude 仅 Code 时返回 `partially-available` |
| 采集 | 单日/闭区间采集正确；checkpoint 可续采；重复采集不增加会话和消息 |
| 归类 | 同一项目只有一个 `projectId`，不按来源拆分 |
| 测试事实 | 状态属于 `passed/failed/blocked/not-run` |
| 证据包 | 九类齐全；空类别有 `present=false` 与 `reason` |
| 校验 | 合法提交 `passed=true`；缺章节/假证据被拒绝 |
| 导出 | 日报/周报统一为「本期结论 + 工作进展 + 问题与质量 + 调研与行动」；HTML 自包含离线，Markdown/PDF 章节一致，JSON 可解析 |
| 回查 | 证据引用可回查；搜索折叠保留 `sources`，各原始会话仍可读取；不存在的证据返回 `E-PKG-002` |
| 待确认 | query/confirm/ignore 状态正确 |
| 安全 | 不产生模型 API Key 调用；不提交凭据文件 |

---

## 7. 常见问题排查

### 7.1 WorkBuddy 看不到织迹工具

检查：

```powershell
node --version
Test-Path D:\项目\WorkWeave\packages\mcp\dist\main.js
```

确认 MCP 配置中的 `args` 是绝对路径，且已执行 `npm run build`。

### 7.2 `ww_source_probe` 返回 `not-found`

- 确认 `WORKWEAVE_HOME` 指向真实用户目录
- 确认对应工具确实产生过记录
- 用 CLI 复核：

```powershell
node packages\cli\dist\main.js probe --platform=win32 --home=C:\Users\Administrator
```

### 7.3 `E-PKG-001` 未知证据包

- 证据包只保存在当前服务进程内
- 重启 WorkBuddy/MCP Server 后，旧 `packageId` 会失效
- 重新调用 `ww_evidence_package` 生成新包，再执行校验/回查

### 7.4 PDF 报 `E-RPT-001`

- 安装中文字体，或设置：

```json
"WORKWEAVE_PDF_FONT": "C:\\Windows\\Fonts\\simhei.ttf"
```

### 7.5 `WORKWEAVE_DB_PATH` 启动失败

SQLite 不会自动创建父目录。先创建：

```powershell
New-Item -ItemType Directory -Force C:\Users\Administrator\.workweave
```

再配置：

```json
"WORKWEAVE_DB_PATH": "C:\\Users\\Administrator\\.workweave\\facts.db"
```

---

## 8. 测试记录模板

| 用例 | 结果 | 实际输出/截图 | 备注 |
|---|---|---|---|
| T01 工具发现 | PASS / FAIL | | |
| T02 来源探测 | PASS / FAIL | | |
| T03 按日采集 | PASS / FAIL | | |
| T04 归类 | PASS / FAIL | | |
| T05 事实抽取 | PASS / FAIL | | |
| T06 证据包 | PASS / FAIL | | |
| T07 Skill 模板 | PASS / FAIL | | |
| T08 九维校验 | PASS / FAIL | | |
| T09 报告导出 | PASS / FAIL | | |
| T10 证据回查 | PASS / FAIL | | |
| T11 待确认项 | PASS / FAIL | | |
| T12 跨工具视图 | PASS / FAIL | | |
| T13 Claude 部分可用 | PASS / FAIL | | |
| T14 幂等/错误 | PASS / FAIL | | |
| T15 跨来源精确去重 | PASS / FAIL | | |

---

## 9. 已知限制

- Claude 目前只做探测与“部分可用”提示，未启用解析器。
- 会话记录与采集 checkpoint 持久化在 SQLite；证据包的 `packageId` 默认保存在内存中，MCP 服务重启后需重新生成证据包。
- PDF 为纯文本排版，不追求完整 HTML/CSS 还原。
- WorkBuddy 是否自动路由到工具取决于其模型；建议在测试时明确写出工具名与参数。
- 项目名现在优先使用仓库根目录/`package.json`/结构化路径，并清理副本后缀；仅在都无法识别时才退回目录名，仍可能不如业务名称准确。
- 事实模式已能基于规则抽取今日任务、完成事项、问题、风险/阻塞与下一步建议，但它不是完整语义总结；宿主叙述合并仍未自动完成。
- 报告导出使用调用方提供的本地路径，请在测试环境使用独立目录，避免覆盖真实文件。
