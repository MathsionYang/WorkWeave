# WorkWeave

English | [简体中文](README.md)

[![CI](https://github.com/MathsionYang/WorkWeave/actions/workflows/ci.yml/badge.svg)](https://github.com/MathsionYang/WorkWeave/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0.0-blue.svg)](packages/mcp)

WorkWeave is a **local-first pipeline for multi-source AI work traces**. It ingests local session records from Codex, Claude, WorkBuddy and dsh, then normalizes, deduplicates, classifies them by project and activity type, extracts test and commit facts, and produces daily or weekly work summaries with traceable evidence.

WorkWeave **does not embed or proxy any large language model**, and requires no API key. It is exposed as an **MCP server / plugin tool** to hosts such as WorkBuddy, which supply their own model for semantic summarization. WorkWeave owns the data pipeline, evidence traceability and report generation.

### Where to start

| I want to | Go to |
|---|---|
| Install and generate my first daily report | [Quick Start](#quick-start) |
| Connect WorkWeave to WorkBuddy | [WorkBuddy Configuration](#workbuddy-configuration) |
| Locate local Codex / dsh / Claude records | [Supported Data Sources](#supported-data-sources) |
| Review the 10 MCP tools and their parameters | [MCP Tools](#mcp-tools) |
| Understand what a report contains | [Report Structure](#report-structure) |
| Troubleshoot configuration errors | [Common configuration errors](#common-configuration-errors) |

---

## Table of Contents

- [Why WorkWeave](#why-workweave)
- [Core Capabilities](#core-capabilities)
- [Architecture](#architecture)
- [Supported Data Sources](#supported-data-sources)
- [Quick Start](#quick-start)
- [WorkBuddy Configuration](#workbuddy-configuration)
- [MCP Tools](#mcp-tools)
- [Report Structure](#report-structure)
- [Security and Privacy](#security-and-privacy)
- [Project Layout](#project-layout)
- [Scripts](#scripts)
- [Testing and CI](#testing-and-ci)
- [Known Limitations](#known-limitations)
- [Documentation](#documentation)
- [Contributors](#contributors)
- [Community](#community)
- [License](#license)

---

## Why WorkWeave

- **Fragmented sources**: conversations are scattered across AI tools and invisible across them.
- **Untraceable summaries**: traditional weekly reports rely on memory and cannot link back to the original session or message.
- **Unreliable test claims**: without a fact layer extracted from command output, "it seemed to work" is hard to verify.
- **Activity-only dashboards**: session counts, token cost and acceptance rates do not answer what was actually built, how good it is, or where work stalled.

WorkWeave turns those raw traces into **project-classified, evidence-backed, reviewable** work summaries.

The key differentiator: **sessions for the same project across Codex, WorkBuddy and dsh are merged into a single project section**, with source distribution reported, instead of writing one summary per tool.

---

## Core Capabilities

| Capability | Description |
|---|---|
| Four-layer source probing | Environment variable → platform default path → existence check → graceful degradation |
| Multi-source ingestion and dedup | Full pipeline for Codex, WorkBuddy and dsh; Claude is probe/degrade only |
| Rule-chain classification | Manual lock > manual rule > configured rule > structured signal > default |
| Test fact extraction | Four states: `passed` / `failed` / `blocked` / `not-run` |
| Commit facts | commit / revert / file-change, deduplicated by commit identifier |
| AI answer adoption | Confirmed, inferred, not adopted, undeterminable; numerator, denominator and undeterminable rate |
| Research highlights | Research topics, conclusion status and supporting evidence |
| Structured evidence package | Nine evidence classes, minimal necessary excerpts, redaction, size capping, resolvable references |
| Cross-tool unified view | Same-project sessions from multiple sources merged into one section with source distribution |
| Eight-part report | Markdown / JSON / HTML / PDF, atomically exported |
| Security boundary | Local-first, hard credential exclusion, path guards, redaction, audit hash chain |

---

## Architecture

```text
WorkBuddy / other MCP hosts
        │  MCP stdio (line-delimited JSON-RPC)
        ▼
┌─────────────────────────────────────────────┐
│ packages/mcp                                │
│  initialize / tools/list / tools/call       │
│  contract negotiation, 2-factor auth,       │
│  parameter validation, idempotency          │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ WorkWeaveRuntime                            │
│  probe → ingest → classify → facts →        │
│  evidence package → export                  │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ packages/core                               │
│  domain model / rule engine / reports /     │
│  evidence package / security                │
│  SQLite fact store / migrations /           │
│  encryption / observability                 │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ packages/adapters                           │
│  Codex / WorkBuddy / dsh / Claude probe     │
│  gates                                      │
└─────────────────────────────────────────────┘
```

The CLI and the MCP server share the same `WorkWeaveRuntime`. A second classification or fact-extraction path is not allowed.

---

## Supported Data Sources

| Source | Default path (Windows) | Status | Format |
|---|---|---|---|
| Codex | `%USERPROFILE%\.codex` | Full pipeline | `sessions/YYYY/MM/DD/*.jsonl`, archived `.jsonl.zst` |
| WorkBuddy | `%USERPROFILE%\.workbuddy` | Full pipeline | `projects/<slug>/<sessionId>.jsonl` |
| dsh | `%USERPROFILE%\.dsh` | Full pipeline | `sessions/**/session.v*.jsonl.zstd` (multi-frame zstd) |
| Claude | `%USERPROFILE%\.claude` | Probe / degraded | Parser enabled only after evidence-gate validation; parsing is not promised today |

Probe precedence:

```text
manual override > user-configured rule > source environment variable > platform default path > other built-in candidates
```

### Source configuration and verification

> WorkWeave reads records that the tools have **already written locally**. It does not need to be installed inside Codex, dsh or Claude.
> Only WorkBuddy acts as both an MCP host and a data source.

#### WorkBuddy: MCP host + data source

- As an MCP host: configure `mcpServers.workweave` as described in [WorkBuddy Configuration](#workbuddy-configuration).
- As a data source: reads `%USERPROFILE%\.workbuddy` by default. Real sessions live in `projects/<slug>/<sessionId>.jsonl` (the top-level `sessions/` may be empty).
- Custom path: set `WORKBUDDY_HOME` in the MCP `env` block.
- Verify: call `ww_source_probe` in WorkBuddy; the `workbuddy` entry should be `discovered`.

#### Codex: data source

- Default path: `%USERPROFILE%\.codex`
- Custom path: set `CODEX_HOME`
- Record layout:
  - Live sessions: `sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl`
  - Archived sessions: `archived_sessions/*.jsonl.zst` (zstd)
  - Session index: `session_index.jsonl`
- Temporary PowerShell setting:

```powershell
$env:CODEX_HOME = "D:\codex-home"
```

- To make it permanent for WorkBuddy, put the variable in the MCP `env` block:

```json
"CODEX_HOME": "D:\\codex-home"
```

- Verify: `ww_source_probe` reports `codex` as `discovered`, with `adoptedPath` pointing to the configured directory.
- Note: in this project Codex is primarily a **data source**. If your Codex version supports acting as an MCP host, fill the same `command` / `args` / `env` into its MCP configuration following that version's documentation; the config file location is defined by Codex.

#### dsh: data source

- Default path: `%USERPROFILE%\.dsh`
- Custom path: set `DSH_HOME`
- Record layout: `sessions/<encoded-project-path>/<sessionId>/session.v3.jsonl.zstd` or `session.v4.jsonl.zstd`
- WorkWeave supports multi-frame zstd decompression and the v3/v4 version boundary. Versions above v4 return `E-SRC-002`; WorkWeave never guesses at the format.
- Temporary PowerShell setting:

```powershell
$env:DSH_HOME = "D:\dsh-home"
```

- Verify: `ww_source_probe` reports `dsh` as `discovered`.

#### Claude: probe / degrade

- Default path: `%USERPROFILE%\.claude`
- Custom path: set `CLAUDE_CONFIG_DIR`
- Record layout: `projects/<encoded-project-path>/<sessionId>.jsonl`
- Current status: probe and "partially available" notice only. The parser is enabled after samples are collected and the evidence gate passes.
- If the machine only has Claude Code records and no Claude Desktop chat records, the probe result is `partially-available` and reports are marked "possibly incomplete". This is expected.
- Temporary PowerShell setting:

```powershell
$env:CLAUDE_CONFIG_DIR = "D:\claude-home"
```

#### Source environment variables

| Source | Environment variable | Default path (Windows) |
|---|---|---|
| Codex | `CODEX_HOME` | `%USERPROFILE%\.codex` |
| WorkBuddy | `WORKBUDDY_HOME` | `%USERPROFILE%\.workbuddy` |
| dsh | `DSH_HOME` | `%USERPROFILE%\.dsh` |
| Claude | `CLAUDE_CONFIG_DIR` | `%USERPROFILE%\.claude` |
| Common | `WORKWEAVE_HOME` | User home directory; used to derive the defaults above |

> `WORKWEAVE_HOME` is the base for default paths; source-specific environment variables take precedence.
> WorkBuddy may not inherit your shell environment when it starts the MCP server. Put the required source variables directly in the MCP `env` block.

---

## Quick Start

### Requirements

- Node.js **24+**
- npm 11+
- Windows / macOS / Linux

### Install and build

> Replace `$ROOT` with your repository root, then run the commands line by line.

```powershell
$ROOT = "D:\path\to\WorkWeave"
cd $ROOT
npm ci
npm run build
npm run guard:no-model
```

### CLI smoke test

```powershell
$ROOT = "D:\path\to\WorkWeave"

# Probe local sources
node "$ROOT\packages\cli\dist\main.js" probe --platform=win32 --home=$env:USERPROFILE

# Generate a daily report (HTML is the default)
node "$ROOT\packages\cli\dist\main.js" report `
  --day=2026-11-04 `
  --out=D:\temp\workweave-daily.html `
  --format=html

# Markdown is available when explicitly requested
node "$ROOT\packages\cli\dist\main.js" report `
  --day=2026-11-04 `
  --out=D:\temp\workweave-daily.md `
  --format=markdown
```

Supported export formats: `markdown` / `json` / `html` / `pdf`. When `--format` is omitted, HTML is produced.

> PDF export requires a CJK font. On Windows the default is `C:\Windows\Fonts\simhei.ttf`; on Linux/macOS set `WORKWEAVE_PDF_FONT` to a TTF/TTC file. If the font is missing and the content contains Chinese, export returns `E-RPT-001` instead of producing a garbled PDF.

### Start the MCP server

```powershell
$ROOT = "D:\path\to\WorkWeave"
node "$ROOT\packages\mcp\dist\main.js"
```

The server speaks line-delimited JSON-RPC over stdin/stdout. Logs go to stderr only, so protocol output stays clean.

Protocol self-check:

```powershell
$ROOT = "D:\path\to\WorkWeave"
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' | node "$ROOT\packages\mcp\dist\main.js"
```

> If you see `Cannot find module 'C:\Users\<user>\packages\mcp\dist\main.js'`, the current directory is not the repository root and `node` resolved the relative path against your home directory. Use the absolute path form above and make sure `npm run build` has been run.

---

## WorkBuddy Configuration

WorkBuddy starts WorkWeave over MCP stdio. The configuration UI differs between WorkBuddy versions, but four pieces of information are always required:

1. Server name
2. Launch command
3. Argument array
4. Environment variables

### Complete JSON example

```json
{
  "mcpServers": {
    "workweave": {
      "command": "node",
      "args": [
        "D:\\path\\to\\WorkWeave\\packages\\mcp\\dist\\main.js"
      ],
      "env": {
        "WORKWEAVE_HOME": "C:\\Users\\<YourName>",
        "WORKWEAVE_PLATFORM": "win32",
        "WORKWEAVE_HOST_ID": "workbuddy",
        "WORKWEAVE_TOKEN": "local-token",
        "WORKWEAVE_DB_PATH": "C:\\Users\\<YourName>\\.workweave\\facts.db",
        "WORKWEAVE_PDF_FONT": "C:\\Windows\\Fonts\\simhei.ttf",
        "CODEX_HOME": "C:\\Users\\<YourName>\\.codex",
        "WORKBUDDY_HOME": "C:\\Users\\<YourName>\\.workbuddy",
        "DSH_HOME": "C:\\Users\\<YourName>\\.dsh",
        "CLAUDE_CONFIG_DIR": "C:\\Users\\<YourName>\\.claude"
      }
    }
  }
}
```

> Replace `<YourName>` with your Windows user name. `WORKWEAVE_DB_PATH` and the source variables are optional. For a first run, start with the minimal configuration and add fields as needed.

### Field reference

| Field | Required | Description |
|---|---|---|
| `mcpServers` | Yes | Top-level object defined by the MCP host; WorkBuddy reads the server list from it |
| `workweave` | Yes | Server identifier; keep `workweave` so the host can associate it with "WorkWeave" |
| `command` | Yes | Launch command. `node` is recommended; use an absolute path if WorkBuddy's PATH does not contain node |
| `args` | Yes | Argument array. The first item must be the **absolute path** to `packages/mcp/dist/main.js` |
| `env` | No | Environment variables passed to the WorkWeave child process; put source paths and tokens here explicitly |

**Two forms of `command`**

```json
"command": "node"
```

Or, when Node is not on PATH:

```json
"command": "C:\\Program Files\\nodejs\\node.exe"
```

**Form of `args`**

```json
"args": ["D:\\path\\to\\WorkWeave\\packages\\mcp\\dist\\main.js"]
```

- Must be an absolute path; do not use `packages/mcp/dist/main.js`
- Paths containing spaces do not need extra escaping because `args` is an array
- Windows backslashes must be written as `\\` in JSON

### Path escaping rules

| Form | Valid | Notes |
|---|---|---|
| `"D:\\path\\to\\WorkWeave\\packages\\mcp\\dist\\main.js"` | Valid | Recommended |
| `"D:\path\to\WorkWeave\packages\mcp\dist\main.js"` | Invalid | `\p` and `\t` are not valid JSON escapes |
| `"D:/path/to/WorkWeave/packages/mcp/dist/main.js"` | Valid | Forward slashes work, but keep backslash escaping consistent across the team |

### Minimal configuration

If Node is on PATH and all sources use default paths, this is sufficient:

```json
{
  "mcpServers": {
    "workweave": {
      "command": "node",
      "args": ["D:\\path\\to\\WorkWeave\\packages\\mcp\\dist\\main.js"]
    }
  }
}
```

Default behavior with the minimal configuration:

- `WORKWEAVE_HOME`: current user home directory
- `WORKWEAVE_PLATFORM`: auto-detected
- `WORKWEAVE_HOST_ID`: `workbuddy`
- `WORKWEAVE_TOKEN`: `local-token`
- SQLite: in-memory database
- PDF: automatic system CJK font detection

### Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `WORKWEAVE_HOME` | No | User home directory | Base directory used to probe every source |
| `WORKWEAVE_PLATFORM` | No | Auto-detected | `win32` / `darwin` / `linux` |
| `WORKWEAVE_HOST_ID` | No | `workbuddy` | Host identifier for the local gateway |
| `WORKWEAVE_TOKEN` | No | `local-token` | Local gateway token; the MCP client does not pass it separately |
| `WORKWEAVE_DB_PATH` | No | In-memory database | SQLite file path; **the parent directory must already exist** |
| `WORKWEAVE_PDF_FONT` | No | Auto-detected | Path to a CJK TTF/TTC font for PDF export |
| `CODEX_HOME` | No | `%USERPROFILE%\.codex` | Codex record root |
| `WORKBUDDY_HOME` | No | `%USERPROFILE%\.workbuddy` | WorkBuddy record root |
| `DSH_HOME` | No | `%USERPROFILE%\.dsh` | dsh record root |
| `CLAUDE_CONFIG_DIR` | No | `%USERPROFILE%\.claude` | Claude record root (probe only today) |

If you enable SQLite persistence, create the parent directory first:

```powershell
New-Item -ItemType Directory -Force "C:\Users\<YourName>\.workweave"
```

### Custom source paths

```json
{
  "mcpServers": {
    "workweave": {
      "command": "node",
      "args": ["D:\\path\\to\\WorkWeave\\packages\\mcp\\dist\\main.js"],
      "env": {
        "WORKWEAVE_HOME": "C:\\Users\\<YourName>",
        "WORKWEAVE_PLATFORM": "win32",
        "CODEX_HOME": "D:\\codex-home",
        "WORKBUDDY_HOME": "D:\\workbuddy-home",
        "DSH_HOME": "D:\\dsh-home"
      }
    }
  }
}
```

Configure only the sources you actually use. Unconfigured sources fall back to default paths; when a path does not exist the probe result is `not-found`, which is a normal degradation.

### Filling in the WorkBuddy UI

If WorkBuddy provides a graphical MCP configuration UI, use this mapping:

| UI field | Suggested value |
|---|---|
| Name | `workweave` |
| Transport | `stdio` |
| Command | `node` |
| Args | `D:\path\to\WorkWeave\packages\mcp\dist\main.js` |
| Env | `WORKWEAVE_*` and source variables as needed |

If the UI only accepts a single launch command, you can use:

```powershell
node "D:\path\to\WorkWeave\packages\mcp\dist\main.js"
```

This is not recommended because multiple environment variables cannot be expressed.

### Verify after configuration

1. Restart WorkBuddy, or refresh the MCP server in settings.
2. Check the tool list: **10** WorkWeave tools should appear.
3. Call `ww_source_probe` and confirm the status of `codex` / `workbuddy` / `dsh`.
4. If no tools appear, check in order:
   - Is `args` the absolute path to `main.js`
   - Has `npm run build` been run
   - Is `node --version` 24 or later
   - Does the JSON validate (especially `\\` escaping)

### Common configuration errors

| Symptom | Likely cause | Fix |
|---|---|---|
| MCP server fails to start | Wrong `args` path or missing build | `Test-Path ...\packages\mcp\dist\main.js`, then run `npm run build` |
| JSON will not save | Windows path not double-escaped | Use `\\` |
| Tools listed but probe is empty | `WORKWEAVE_HOME` points to the wrong directory | Set it to the real user home directory |
| Codex records not found | `CODEX_HOME` not applied | Put it in the WorkBuddy `env` block, not only in the shell |
| `E-PKG-001` unknown evidence package | Old `packageId` expired after a restart | Call `ww_evidence_package` again |
| `E-RPT-001` | PDF has no CJK font | Set `WORKWEAVE_PDF_FONT` |
| Pending items lost after restart | SQLite persistence not enabled | Set `WORKWEAVE_DB_PATH` and create the parent directory |

Once configured, ask WorkBuddy:

```text
WorkWeave, probe the AI record sources on my machine
```

Or name the tool explicitly:

```text
Call ww_source_probe with source=workbuddy
```

For step-by-step manual verification, see [`docs/WorkBuddy-测试手册.md`](docs/WorkBuddy-测试手册.md) (Chinese).

---

## MCP Tools

Contract version: `1.0.0`

| Tool | Purpose | Main parameters |
|---|---|---|
| `ww_source_probe` | Probe source availability and completeness | `source?`, `ignoreCache?` |
| `ww_source_ingest` | Ingest, normalize and deduplicate by day | `day`, `source?`, `waitForCompletion?` |
| `ww_work_classify` | Classify projects and activity types with the rule chain | `day`, `projectId?` |
| `ww_fact_extract` | Extract test, commit and issue facts | `day` |
| `ww_evidence_package` | Build the nine-class structured evidence package | `day`, `maxEntries?` |
| `ww_skill_template_get` | Return the six-part summary template | None |
| `ww_summary_validate` | Nine-dimension validation of host output | `packageId`, `templateVersion`, `sections` |
| `ww_report_export` | Export HTML (default) / JSON / Markdown / PDF | `day`, `out`, `format?` |
| `ww_pending_manage` | Query, confirm or ignore pending items | `day`, `type?`, `action?`, `id?` |
| `ww_evidence_resolve` | Resolve evidence by reference | `packageId`, `evidenceId` |

Every tool declares `hasBody: false`: it accepts parameters and reference identifiers only, and never receives or executes full conversation bodies sent back by the host.

---

## Report Structure

HTML is the primary report format and includes self-contained offline charts; Markdown and JSON are companion and authoritative formats. Beyond metrics, every report answers three questions: what was done, what the results were, and what still needs improvement.

1. **Daily overview**: one-line summary, session/project/test/commit/adoption metrics, next-step recommendations
2. **AI collaboration and adoption**: confirmed / inferred / not adopted / determinable sample / reasons undeterminable
3. **Research highlights**: topics, conclusion status, reasons and evidence; system prompts and small talk do not count as research
4. **Per-project summary**:
   - Human-readable project name, source distribution
   - Today's tasks, completed items, issues, tests and quality
   - Risks / blockers / pending improvements, next-step recommendations
5. **Cross-project and unassigned items**
6. **Pure-conversation classification summary**
7. **Pending items**: low confidence, record-completeness gaps and similar
8. **Evidence index**: session / message / time / source references

Reports filter out system prompts, `environment_context`, tool scaffolding and other noise. Project names prefer the repository root, `package.json` or structured paths, avoiding timestamps and unreadable directory names.

The report completeness marker exposes exactly two external values:

- `complete`
- `possibly incomplete`

"Completeness undeterminable" appears as a reason note only, never as a standalone external status, so hosts cannot misread it.

---

## Security and Privacy

- **No model dependency**: `npm run guard:no-model` blocks model SDKs, model endpoints and API keys from entering the repository.
- **Local-first**: reads local records only by default and never uploads raw conversations.
- **Hard credential exclusion**: `settings.json`, `.credentials*`, `.env`, `keyblob`, `security/`, `login-device-nonce` and similar files are never ingested.
- **Path guards**: path traversal, symbolic links and export allowlist checks.
- **Redaction**: one rule set across evidence packages, reports, logs and diagnostics, with minimal message excerpts.
- **Audit**: hash chain, tamper detection, retention of at least 180 days.
- **MCP gateway**: contract negotiation, two-factor authentication, parameter allowlist, `callId` idempotency.

---

## Project Layout

```text
packages/
  core/       domain model, probing, ingestion, classification, facts,
              evidence package, reports, security, storage
  adapters/   Codex / WorkBuddy / dsh / Claude evidence gates
  mcp/        MCP contract, gateway, stdio service, runtime handlers
  cli/        command-line entry points (probe / report / MCP)
tests/        unit, integration and scenario tests
scripts/      bench, Claude evidence collection, no-model guard
docs/         WorkBuddy test manual
.github/      CI
```

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` | Build the TypeScript project |
| `npm run typecheck` | Type check |
| `npm run lint` | ESLint |
| `npm test` | Full test suite |
| `npm run test:scenarios` | V-01 to V-33 scenario tests |
| `npm run guard:no-model` | No-model dependency guard |
| `npm run bench` | 50k-message performance benchmark |
| `node packages/cli/dist/main.js probe` | CLI source probe |
| `node packages/cli/dist/main.js report` | CLI report export |
| `node packages/mcp/dist/main.js` | Start the MCP stdio service |

---

## Testing and CI

- Scenario matrix: V-01 to V-33, covering probe precedence, cross-tool merging, completeness, host validation, degradation, path safety and concurrent idempotency.
- Three-platform CI: `.github/workflows/ci.yml` runs on Ubuntu / Windows / macOS and executes `npm ci`, build, lint, the no-model guard, the full test suite and scenario tests.
- Performance benchmark: `npm run bench` with 50k messages; evidence-package trimming must stay linear.
- PDF tests skip automatically, or return `E-RPT-001` as expected, on environments without CJK fonts.

---

## Known Limitations

- Claude is currently probe-only with a "partially available" notice; the parser must be enabled after samples are collected and the evidence gate passes.
- Evidence packages live in the current process memory, so `packageId` becomes invalid after a restart; pending items can be persisted with `WORKWEAVE_DB_PATH`.
- PDF output is plain text layout; full HTML/CSS fidelity is out of scope.
- Whether WorkBuddy automatically routes to a tool depends on the host model; during testing, name the tool and parameters explicitly.
- Project names prefer the repository root / `package.json` / structured paths, falling back to the directory name only when nothing else is identifiable.
- Fact mode extracts tasks, completed items, issues, risks/blockers and next steps by rule; it is not a full semantic summary, and merging host narratives is not automated yet.
- MCP stdio uses line-delimited JSON-RPC; hosts using other framing need a transport adapter.

---

## Documentation

- [WorkBuddy test manual (Chinese)](docs/WorkBuddy-测试手册.md)
- [简体中文 README](README.md)

---

## Contributors

| Contributor | Role |
|---|---|
| [MathsionYang](https://github.com/MathsionYang) | Project author, product and specification lead |
| CodeArts Agent | Implementation, testing and documentation collaboration |

Issues and suggestions are welcome via GitHub Issues and Discord. When submitting code, include the corresponding verification results.

---

## Community

- Discord: [Join the WorkWeave Discord](https://discord.gg/PXcJdgd9d)
- GitHub Issues: <https://github.com/MathsionYang/WorkWeave/issues>

---

## License

Released under the [MIT License](LICENSE).

Copyright (c) 2026 MathsionYang