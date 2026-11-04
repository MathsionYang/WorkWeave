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

---

## 快速开始

### 环境要求

- Node.js **24+**
- npm 11+
- Windows / macOS / Linux

### 安装与构建

```bash
npm ci
npm run build
npm run guard:no-model
```

### CLI 快速验证

```bash
# 探测本机来源
node packages/cli/dist/main.js probe --platform=win32 --home=%USERPROFILE%

# 生成日报（Markdown）
node packages/cli/dist/main.js report \
  --day=2026-11-04 \
  --out=D:\temp\workweave-daily.md \
  --format=markdown
```

支持的导出格式：`markdown` / `json` / `html` / `pdf`。

> PDF 需要中文字体。Windows 默认使用 `C:\Windows\Fonts\simhei.ttf`；Linux/macOS 可通过 `WORKWEAVE_PDF_FONT` 指定 TTF/TTC 字体路径。字体缺失且内容含中文时返回 `E-RPT-001`，不会生成乱码 PDF。

### 启动 MCP Server

```bash
node packages/mcp/dist/main.js
```

服务通过 stdin/stdout 使用逐行 JSON-RPC；日志只写 stderr，避免污染协议输出。

协议自检：

```powershell
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' | node packages\mcp\dist\main.js
```

---

## 在 WorkBuddy 中配置

在 WorkBuddy 的 MCP Server 配置中加入（路径按实际项目位置修改）：

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

可选环境变量：

| 变量 | 说明 |
|---|---|
| `WORKWEAVE_HOME` | 用户主目录，织迹据此探测各来源 |
| `WORKWEAVE_PLATFORM` | `win32` / `darwin` / `linux` |
| `WORKWEAVE_HOST_ID` | 宿主标识，默认 `workbuddy` |
| `WORKWEAVE_TOKEN` | 本地网关令牌，默认 `local-token` |
| `WORKWEAVE_DB_PATH` | SQLite 文件路径；不设置则使用内存库，父目录需存在 |
| `WORKWEAVE_PDF_FONT` | PDF 中文字体路径 |

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
| `ww_report_export` | 导出 Markdown/JSON/HTML/PDF | `day`、`out`、`format?` |
| `ww_pending_manage` | 查询/确认/忽略待确认项 | `day`、`type?`、`action?`、`id?` |
| `ww_evidence_resolve` | 按引用回查证据 | `packageId`、`evidenceId` |

所有工具均声明 `hasBody: false`：只接收参数与引用标识，不接收也不执行宿主回传的完整对话正文。

---

## 报告结构（八部分）

1. **今日概览**：会话、项目、测试、采纳、提交、调研等指标
2. **AI 协作与采纳**：四种采纳状态、分子/分母、无法判定率
3. **今日调研**：主题、结论状态、原因与证据
4. **按项目总结**：同一项目多来源合并，附来源分布
5. **跨项目与未归属事项**
6. **纯对话归类摘要**
7. **待确认项**：低置信度、记录完整性缺口等
8. **证据索引**：会话/消息/时间/来源引用

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
- MCP stdio 使用逐行 JSON-RPC；若宿主使用其他 framing，需要适配传输层。

---

## 文档

- [WorkBuddy 测试手册](docs/WorkBuddy-测试手册.md)

---

## License

暂未添加开源许可证。使用前请与仓库所有者确认授权范围。