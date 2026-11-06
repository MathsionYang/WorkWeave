# 织迹（WorkWeave）

[![CI](https://github.com/MathsionYang/WorkWeave/actions/workflows/ci.yml/badge.svg)](https://github.com/MathsionYang/WorkWeave/actions/workflows/ci.yml)

织迹是一个**本地优先的多源 AI 工作痕迹管道**：采集 Codex、Claude、WorkBuddy、dsh 的本地会话记录，完成标准化、去重、项目与活动类别归类、测试与提交事实抽取，输出带证据引用的每日/每周工作总结。

织迹**不内置、不代理大模型**，也不需要用户配置任何 API Key。它作为 **MCP Server / 插件工具** 暴露给 WorkBuddy 等宿主，由宿主自带模型完成语义总结；织迹负责数据管道、证据追溯与报告落盘。

---

## 为什么需要织迹

- **多源分散**：对话记录散落在不同 AI 工具里，跨工具不可见。
- **总结不可追溯**：传统周报靠回忆，无法回跳到原始会话/消息。
- **测试结果不可信**：没有从命令输出中抽取的事实层，容易被“感觉跑通了”误导。
- **官方看板只有活动量**：会话数、token 成本、采纳率不等于“实际做了什么、质量如何、哪里卡住了”。

织迹把这些原始痕迹转成**按项目归类、带证据、可复核**的工作摘要。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| 四层来源探测 | 环境变量 → 平台默认路径 → 存在性校验 → 未命中降级 |
| 多源采集与去重 | Codex、WorkBuddy、dsh 全链路；Claude 当前仅探测/降级 |
| 规则链归类 | 人工锁定 > 人工规则 > 配置规则 > 结构化线索 > 默认 |
| 测试事实抽取 | `passed` / `failed` / `blocked` / `not-run` 四态 |
| 提交事实 | commit / revert / file-change，按提交标识去重 |
| AI 回答采纳度 | 可确证采纳、推断采纳、未采纳、无法判定；给出分子/分母/无法判定率 |
| 今日调研 | 识别调研主题、结论状态与证据 |
| 结构化证据包 | 九类证据、最小必要片段、脱敏、上限裁剪、可回查 |
| 跨工具统一视图 | 同一项目多来源会话合并为一个项目章节，并给出来源分布 |
| 八部分报告 | Markdown / JSON / HTML / PDF，原子导出 |
| 安全边界 | 本地优先、凭据硬排除、路径守卫、脱敏、审计哈希链 |

---

## 架构

```text
WorkBuddy / 其他 MCP 宿主
        │  MCP stdio（逐行 JSON-RPC）
        ▼
┌─────────────────────────────────────────────┐
│ packages/mcp                                │
│  initialize / tools/list / tools/call       │
│  契约版本协商、双要素鉴权、参数校验、幂等    │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ WorkWeaveRuntime                            │
│  探测 → 采集 → 归类 → 事实 → 证据包 → 导出  │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ packages/core                               │
│  领域模型 / 规则引擎 / 报告 / 证据包 / 安全  │
│  SQLite 事实仓 / 迁移 / 加密 / 可观测性      │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ packages/adapters                           │
│  Codex / WorkBuddy / dsh / Claude 探测门禁   │
└─────────────────────────────────────────────┘
```

CLI 与 MCP 共用同一个 `WorkWeaveRuntime`，不允许出现第二套归类/事实口径。

---

## 支持的数据来源

| 来源 | 默认路径（Windows） | 状态 | 格式 |
|---|---|---|---|
| Codex | `%USERPROFILE%\.codex` | 全链路 | `sessions/YYYY/MM/DD/*.jsonl`，归档 `.jsonl.zst` |
| WorkBuddy | `%USERPROFILE%\.workbuddy` | 全链路 | `projects/<slug>/<sessionId>.jsonl` |
| dsh | `%USERPROFILE%\.dsh` | 全链路 | `sessions/**/session.v*.jsonl.zstd`（多帧 zstd） |
| Claude | `%USERPROFILE%\.claude` | 仅探测/降级 | 取证后启用解析器；当前不承诺解析 |

探测优先级：

```text
人工手动指定 > 用户配置规则 > 来源环境变量 > 平台默认路径 > 其他内置候选
```

### 各来源配置与验证

> 织迹读取的是各工具**已经写入本地**的记录，不需要把织迹安装进 Codex / dsh / Claude。  
> 只有 WorkBuddy 同时承担「MCP 宿主」与「数据源」两个角色。

#### WorkBuddy：MCP 宿主 + 数据源

- 作为 MCP 宿主：按下一节配置 `mcpServers.workweave`。
- 作为数据源：默认读取 `%USERPROFILE%\.workbuddy`，真实会话位于 `projects/<slug>/<sessionId>.jsonl`（顶层 `sessions/` 可能为空）。
- 自定义路径：在 WorkBuddy 的 MCP `env` 中设置 `WORKBUDDY_HOME`。
- 验证：在 WorkBuddy 中调用 `ww_source_probe`，期望 `workbuddy` 行为 `discovered`。

#### Codex：数据源

- 默认路径：`%USERPROFILE%\.codex`
- 自定义路径：设置 `CODEX_HOME`
- 记录布局：
  - 在线会话：`sessions/YYYY/MM/DD/rollout-<时间>-<uuid>.jsonl`
  - 归档会话：`archived_sessions/*.jsonl.zst`（zstd）
  - 会话索引：`session_index.jsonl`
- PowerShell 临时设置：

```powershell
$env:CODEX_HOME = "D:\codex-home"
```

- 若要固定给 WorkBuddy 使用，把变量写进 MCP 配置的 `env`：

```json
"CODEX_HOME": "D:\\codex-home"
```

- 验证：`ww_source_probe` 的 `codex` 行为 `discovered`，且 `adoptedPath` 指向你设置的目录。
- 说明：Codex 在当前项目中主要作为**数据源**。若你的 Codex 版本支持作为 MCP 宿主，可按该版本文档把同样的 `command` / `args` / `env` 填入其 MCP 配置；配置文件位置以 Codex 官方说明为准。

#### dsh：数据源

- 默认路径：`%USERPROFILE%\.dsh`
- 自定义路径：设置 `DSH_HOME`
- 记录布局：`sessions/<编码项目路径>/<sessionId>/session.v3.jsonl.zstd` 或 `session.v4.jsonl.zstd`
- 织迹支持多帧 zstd 解压与 v3/v4 版本边界；高于 v4 会返回 `E-SRC-002`，不会猜测解析。
- PowerShell 临时设置：

```powershell
$env:DSH_HOME = "D:\dsh-home"
```

- 验证：`ww_source_probe` 的 `dsh` 行为 `discovered`。

#### Claude：探测 / 降级

- 默认路径：`%USERPROFILE%\.claude`
- 自定义路径：设置 `CLAUDE_CONFIG_DIR`
- 记录布局：`projects/<编码项目路径>/<sessionId>.jsonl`
- 当前状态：仅接入探测与“部分可用”提示，解析器需取得样本并通过取证门禁后启用。
- 如果本机只有 Claude Code 记录、没有 Claude Desktop 普通聊天，探测结果为 `partially-available`，报告会标注“可能不完整”，这是预期行为。
- 验证：

```powershell
$env:CLAUDE_CONFIG_DIR = "D:\claude-home"
```

#### 来源环境变量总表

| 来源 | 环境变量 | 默认路径（Windows） |
|---|---|---|
| Codex | `CODEX_HOME` | `%USERPROFILE%\.codex` |
| WorkBuddy | `WORKBUDDY_HOME` | `%USERPROFILE%\.workbuddy` |
| dsh | `DSH_HOME` | `%USERPROFILE%\.dsh` |
| Claude | `CLAUDE_CONFIG_DIR` | `%USERPROFILE%\.claude` |
| 通用 | `WORKWEAVE_HOME` | 用户主目录；用于推导上述默认路径 |

> `WORKWEAVE_HOME` 是默认路径的基准；来源专属环境变量的优先级更高。  
> WorkBuddy 启动 MCP Server 时可能不继承你的 shell 环境，建议把需要的来源变量直接写进 MCP 配置的 `env`。

---

## 快速开始

### 环境要求

- Node.js **24+**
- npm 11+
- Windows / macOS / Linux

### 安装与构建

> 以下命令必须在项目根目录 `D:\项目\WorkWeave` 下执行。

```bash
npm ci
npm run build
npm run guard:no-model
```

### CLI 快速验证

> 以下命令必须在项目根目录下执行；如果当前目录不在项目根目录，请把 `packages/cli/dist/main.js` 换成绝对路径。

```bash
# 探测本机来源
node packages/cli/dist/main.js probe --platform=win32 --home=%USERPROFILE%

# 生成日报（HTML，默认）
node packages/cli/dist/main.js report \
  --day=2026-11-04 \
  --out=D:\temp\workweave-daily.html \
  --format=html

# 如需 Markdown，显式指定
node packages/cli/dist/main.js report \
  --day=2026-11-04 \
  --out=D:\temp\workweave-daily.md \
  --format=markdown
```

支持的导出格式：`markdown` / `json` / `html` / `pdf`。

> PDF 需要中文字体。Windows 默认使用 `C:\Windows\Fonts\simhei.ttf`；Linux/macOS 可通过 `WORKWEAVE_PDF_FONT` 指定 TTF/TTC 字体路径。字体缺失且内容含中文时返回 `E-RPT-001`，不会生成乱码 PDF。

### 启动 MCP Server

```powershell
cd D:\项目\WorkWeave
node .\packages\mcp\dist\main.js
```

服务通过 stdin/stdout 使用逐行 JSON-RPC；日志只写 stderr，避免污染协议输出。

协议自检：

```powershell
# 方式一：先进入项目根目录
cd D:\项目\WorkWeave
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' | node .\packages\mcp\dist\main.js

# 方式二：不切换目录，直接使用绝对路径
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' | node "D:\项目\WorkWeave\packages\mcp\dist\main.js"
```

> 如果出现 `Cannot find module 'C:\Users\<用户>\packages\mcp\dist\main.js'`，说明当前目录不在项目根目录，`node` 把相对路径解析到了用户目录。先执行 `cd D:\项目\WorkWeave`，或改用上面的绝对路径写法；同时确认已执行过 `npm run build`。

---

## 在 WorkBuddy 中配置（MCP Server JSON 详解）

WorkBuddy 通过 MCP stdio 启动织迹。不同版本的 WorkBuddy 配置界面可能不同，但最终都需要提供四类信息：

1. 服务名称
2. 启动命令
3. 参数数组
4. 环境变量

### 完整 JSON 示例

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
        "WORKWEAVE_TOKEN": "local-token",
        "WORKWEAVE_DB_PATH": "C:\\Users\\Administrator\\.workweave\\facts.db",
        "WORKWEAVE_PDF_FONT": "C:\\Windows\\Fonts\\simhei.ttf",
        "CODEX_HOME": "C:\\Users\\Administrator\\.codex",
        "WORKBUDDY_HOME": "C:\\Users\\Administrator\\.workbuddy",
        "DSH_HOME": "C:\\Users\\Administrator\\.dsh",
        "CLAUDE_CONFIG_DIR": "C:\\Users\\Administrator\\.claude"
      }
    }
  }
}
```

> `WORKWEAVE_DB_PATH` 与各来源变量都是可选项。第一次测试建议先使用“最小配置”，跑通后再按需添加。

### 字段逐项说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `mcpServers` | 是 | MCP 宿主约定的顶层对象；WorkBuddy 从这里读取服务列表 |
| `workweave` | 是 | 服务标识，可自定义；建议保持 `workweave`，便于后续提问“织迹”时识别 |
| `command` | 是 | 启动命令。推荐 `node`；若 WorkBuddy 的 PATH 找不到 node，改为绝对路径 |
| `args` | 是 | 参数数组。第一项必须是 `packages/mcp/dist/main.js` 的**绝对路径** |
| `env` | 否 | 传给织迹子进程的环境变量；建议把来源路径、令牌显式写在这里 |

**`command` 的两种写法**

```json
"command": "node"
```

或者 Node 不在 PATH 时：

```json
"command": "C:\\Program Files\\nodejs\\node.exe"
```

**`args` 的写法**

```json
"args": ["D:\\项目\\WorkWeave\\packages\\mcp\\dist\\main.js"]
```

- 必须是绝对路径；不要写 `packages/mcp/dist/main.js`
- 路径含空格不需要额外转义，因为 `args` 是数组
- Windows 反斜杠在 JSON 中必须写成 `\\`

### 路径转义规则

| 写法 | 是否合法 | 说明 |
|---|---|---|
| `"D:\\项目\\WorkWeave\\packages\\mcp\\dist\\main.js"` | 合法 | 推荐 |
| `"D:\项目\WorkWeave\packages\mcp\dist\main.js"` | 非法 | JSON 中 `\项` 不是合法转义 |
| `"D:/项目/WorkWeave/packages/mcp/dist/main.js"` | 合法 | 正斜杠也可用，但团队内建议统一反斜杠转义 |

### 最小配置

如果 Node 在 PATH 中，且所有来源都在默认路径，使用以下配置即可：

```json
{
  "mcpServers": {
    "workweave": {
      "command": "node",
      "args": ["D:\\项目\\WorkWeave\\packages\\mcp\\dist\\main.js"]
    }
  }
}
```

最小配置下的默认行为：

- `WORKWEAVE_HOME`：当前用户主目录
- `WORKWEAVE_PLATFORM`：自动识别
- `WORKWEAVE_HOST_ID`：`workbuddy`
- `WORKWEAVE_TOKEN`：`local-token`
- SQLite：使用内存库
- PDF：自动探测系统 CJK 字体

### 环境变量详解

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `WORKWEAVE_HOME` | 否 | 用户主目录 | 织迹探测各来源的基准目录 |
| `WORKWEAVE_PLATFORM` | 否 | 自动识别 | `win32` / `darwin` / `linux` |
| `WORKWEAVE_HOST_ID` | 否 | `workbuddy` | 本地网关宿主标识 |
| `WORKWEAVE_TOKEN` | 否 | `local-token` | 本地网关校验令牌；MCP 客户端无需单独传递 |
| `WORKWEAVE_DB_PATH` | 否 | 内存库 | SQLite 文件路径；**父目录必须已存在** |
| `WORKWEAVE_PDF_FONT` | 否 | 自动探测 | PDF 中文字体 TTF/TTC 路径 |
| `CODEX_HOME` | 否 | `%USERPROFILE%\.codex` | Codex 记录根目录 |
| `WORKBUDDY_HOME` | 否 | `%USERPROFILE%\.workbuddy` | WorkBuddy 记录根目录 |
| `DSH_HOME` | 否 | `%USERPROFILE%\.dsh` | dsh 记录根目录 |
| `CLAUDE_CONFIG_DIR` | 否 | `%USERPROFILE%\.claude` | Claude 记录根目录（当前仅探测） |

如果启用 SQLite 持久化，先创建父目录：

```powershell
New-Item -ItemType Directory -Force C:\Users\Administrator\.workweave
```

### 自定义来源路径示例

```json
{
  "mcpServers": {
    "workweave": {
      "command": "node",
      "args": ["D:\\项目\\WorkWeave\\packages\\mcp\\dist\\main.js"],
      "env": {
        "WORKWEAVE_HOME": "C:\\Users\\Administrator",
        "WORKWEAVE_PLATFORM": "win32",
        "CODEX_HOME": "D:\\codex-home",
        "WORKBUDDY_HOME": "D:\\workbuddy-home",
        "DSH_HOME": "D:\\dsh-home"
      }
    }
  }
}
```

只配置你实际使用的来源。未配置的来源会使用默认路径；路径不存在时探测结果为 `not-found`，属于正常降级。

### 在 WorkBuddy UI 中填写

如果 WorkBuddy 使用图形化 MCP 配置界面，可按以下映射填写：

| UI 字段 | 建议值 |
|---|---|
| 名称 / Name | `workweave` |
| 类型 / Transport | `stdio` |
| 命令 / Command | `node` |
| 参数 / Args | `D:\项目\WorkWeave\packages\mcp\dist\main.js` |
| 环境变量 / Env | 按需填写上表中的 `WORKWEAVE_*` 与来源变量 |

如果 UI 只允许填写一条启动命令，可使用：

```powershell
node "D:\项目\WorkWeave\packages\mcp\dist\main.js"
```

但不推荐这种方式，因为无法完整表达多个环境变量。

### 配置后验证

1. 重启 WorkBuddy，或在设置中刷新 MCP Server。
2. 查看工具列表，应出现 **10 个**织迹工具。
3. 调用 `ww_source_probe`，确认 `codex` / `workbuddy` / `dsh` 的状态。
4. 如果看不到工具，依次检查：
   - `args` 是否为 `main.js` 的绝对路径
   - 是否执行过 `npm run build`
   - `node --version` 是否为 24+
   - JSON 是否通过校验（重点检查 `\\` 转义）

### 常见配置错误

| 现象 | 常见原因 | 处理 |
|---|---|---|
| MCP Server 启动失败 | `args` 路径错误或未构建 | `Test-Path ...\packages\mcp\dist\main.js`，并执行 `npm run build` |
| JSON 无法保存 | Windows 路径未双写反斜杠 | 改为 `\\` |
| 工具能列出但探测为空 | `WORKWEAVE_HOME` 指向错误 | 设置为真实用户主目录 |
| 找不到 Codex 记录 | `CODEX_HOME` 未生效 | 写入 WorkBuddy 的 `env`，不要只设置 shell 变量 |
| `E-PKG-001` 未知证据包 | 服务重启后旧 `packageId` 失效 | 重新调用 `ww_evidence_package` |
| `E-RPT-001` | PDF 缺少中文字体 | 设置 `WORKWEAVE_PDF_FONT` |
| 待确认项重启后丢失 | 未启用 SQLite 持久化 | 配置 `WORKWEAVE_DB_PATH` 并创建父目录 |

配置完成后，在 WorkBuddy 中说：

```text
织迹，探测我本机的 AI 记录来源
```

或明确指定工具：

```text
调用 ww_source_probe，参数 source=workbuddy
```

完整的逐步测试步骤见：[`docs/WorkBuddy-测试手册.md`](docs/WorkBuddy-测试手册.md)。

---

## MCP 工具

契约版本：`1.0.0`

| 工具 | 作用 | 主要参数 |
|---|---|---|
| `ww_source_probe` | 探测来源可用性与完整性 | `source?`、`ignoreCache?` |
| `ww_source_ingest` | 按日采集、标准化、去重 | `day`、`source?`、`waitForCompletion?` |
| `ww_work_classify` | 规则链归类项目与活动类别 | `day`、`projectId?` |
| `ww_fact_extract` | 抽取测试、提交、问题等事实 | `day` |
| `ww_evidence_package` | 生成九类结构化证据包 | `day`、`maxEntries?` |
| `ww_skill_template_get` | 返回六部分总结模板 | 无 |
| `ww_summary_validate` | 九维校验宿主生成结果 | `packageId`、`templateVersion`、`sections` |
| `ww_report_export` | 导出 HTML（默认）/ JSON / Markdown / PDF | `day`、`out`、`format?` |
| `ww_pending_manage` | 查询/确认/忽略待确认项 | `day`、`type?`、`action?`、`id?` |
| `ww_evidence_resolve` | 按引用回查证据 | `packageId`、`evidenceId` |

所有工具均声明 `hasBody: false`：只接收参数与引用标识，不接收也不执行宿主回传的完整对话正文。

---

## 报告结构（八部分）

HTML 是默认主报告，包含自包含离线图表；Markdown/JSON 为附属与权威格式。每份报告在指标之外还必须回答：我做了什么、结果如何、哪些需要继续优化。

1. **今日概览**：一句话总结、会话/项目/测试/提交/采纳指标、下一步建议
2. **AI 协作与采纳**：可确证/推断/未采纳/可判定样本/无法判定原因
3. **今日调研**：主题、结论状态、原因与证据；系统提示与闲聊不算调研
4. **按项目总结**：业务可读项目名、来源分布、今日任务、完成事项、问题、测试与质量、风险/阻塞/待优化、下一步建议
5. **跨项目与未归属事项**
6. **纯对话归类摘要**
7. **待确认项**：低置信度、记录完整性缺口等
8. **证据索引**：会话/消息/时间/来源引用

报告会过滤系统提示、`environment_context`、工具脚手架等噪声；项目名优先取仓库根目录/`package.json`/结构化路径，避免时间戳与不可读目录名。

报告完整性标记只有两种对外取值：

- `完整`
- `可能不完整`

“完整性无法判定”作为原因附注，不单独作为对外状态，避免宿主误读。

---

## 安全与隐私

- **无模型依赖**：`npm run guard:no-model` 会阻止模型 SDK、模型端点与 API Key 进入仓库。
- **本地优先**：默认只读本机记录，不上传原始对话。
- **凭据硬排除**：`settings.json`、`.credentials*`、`.env`、`keyblob`、`security/`、`login-device-nonce` 等文件不会被采集。
- **路径守卫**：路径穿越、符号链接、导出白名单校验。
- **脱敏**：证据包/报告/日志/诊断统一规则，消息片段最小化。
- **审计**：哈希链、篡改检测、保留期不少于 180 天。
- **MCP 网关**：契约版本协商、双要素鉴权、参数白名单、`callId` 幂等。

---

## 项目结构

```text
packages/
  core/       领域模型、探测、采集、归类、事实、证据包、报告、安全、仓储
  adapters/   Codex / WorkBuddy / dsh / Claude 取证门禁
  mcp/        MCP 契约、网关、stdio 服务、运行时处理器
  cli/        命令行入口（probe / report / MCP）
tests/        单元、集成、场景测试
scripts/      bench、Claude 取证、无模型门禁
docs/         WorkBuddy 测试手册
.github/      CI
```

---

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run build` | TypeScript 项目构建 |
| `npm run typecheck` | 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | 完整测试套件 |
| `npm run test:scenarios` | V-01~V-33 场景测试 |
| `npm run guard:no-model` | 无模型依赖门禁 |
| `npm run bench` | 5 万消息性能基准 |
| `node packages/cli/dist/main.js probe` | CLI 探测 |
| `node packages/cli/dist/main.js report` | CLI 导出报告 |
| `node packages/mcp/dist/main.js` | 启动 MCP stdio 服务 |

---

## 测试与 CI

- 场景矩阵：V-01~V-33，覆盖探测优先级、跨工具合并、完整性、宿主校验、降级、路径安全与并发幂等。
- 三平台 CI：`.github/workflows/ci.yml`，矩阵为 Ubuntu / Windows / macOS，执行 `npm ci`、build、lint、无模型门禁、完整测试与场景测试。
- 性能基准：`npm run bench`，5 万消息；证据包裁剪必须保持线性复杂度。
- PDF 测试在无 CJK 字体的环境会自动跳过或按预期返回 `E-RPT-001`。

---

## 已知限制

- Claude 目前只做探测与“部分可用”提示，解析器需在取得样本并通过取证门禁后启用。
- 证据包保存在当前进程内存中，服务重启后 `packageId` 失效；待确认项可通过 `WORKWEAVE_DB_PATH` 持久化。
- PDF 为纯文本排版，不追求完整 HTML/CSS 还原。
- WorkBuddy 是否自动路由到工具取决于宿主模型；测试时建议明确写出工具名与参数。
- 项目名优先取仓库根目录/`package.json`/结构化路径；无法识别时才退回目录名。
- 事实模式能基于规则抽取任务、完成事项、问题、风险/阻塞与下一步建议，但不是完整语义总结；宿主叙述合并尚未自动完成。
- MCP stdio 使用逐行 JSON-RPC；若宿主使用其他 framing，需要适配传输层。

---

## 文档

- [WorkBuddy 测试手册](docs/WorkBuddy-测试手册.md)

---

## 社区与反馈

- Discord 社区：[加入织迹 WorkWeave Discord](https://discord.gg/PXcJdgd9d)

---

## License

本项目采用 [MIT License](LICENSE)。

Copyright (c) 2026 MathsionYang