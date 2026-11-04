import { DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES, SKILL_TEMPLATE_VERSION, SOURCE_TOOL_VALUES } from "@workweave/core";
import type { CapabilityDeclaration, ToolContract } from "./types.js";
import { MCP_CONTRACT_VERSION, MCP_PROTOCOL_VERSIONS } from "./types.js";

const noBody = "不返回对话全文；仅返回结构化结论、脱敏片段或引用标识" as const;

export const TOOL_CONTRACTS: readonly ToolContract[] = [
  {
    name: "ww_source_probe",
    title: "探测来源",
    description: `确认 Codex / Claude / WorkBuddy / dsh 的本机记录可用性与完整性。${noBody}`,
    permission: "read-probe",
    hasBody: false,
    params: [
      { name: "source", required: false, type: "string", enum: SOURCE_TOOL_VALUES },
      { name: "ignoreCache", required: false, type: "boolean" }
    ]
  },
  {
    name: "ww_source_ingest",
    title: "采集来源",
    description: `增量采集指定日期的本地记录并标准化、去重。${noBody}`,
    permission: "read-ingest",
    hasBody: false,
    params: [
      { name: "day", required: true, type: "string" },
      { name: "source", required: false, type: "string", enum: SOURCE_TOOL_VALUES },
      { name: "waitForCompletion", required: false, type: "boolean" }
    ]
  },
  {
    name: "ww_work_classify",
    title: "工作归类",
    description: `按规则链归类项目与活动类别，不做模型判定。${noBody}`,
    permission: "local-read-write",
    hasBody: false,
    params: [
      { name: "day", required: true, type: "string" },
      { name: "projectId", required: false, type: "string" }
    ]
  },
  {
    name: "ww_fact_extract",
    title: "事实抽取",
    description: `抽取测试四态、提交、问题、优化项、采纳与调研事实。${noBody}`,
    permission: "local-read-write",
    hasBody: false,
    params: [{ name: "day", required: true, type: "string" }]
  },
  {
    name: "ww_evidence_package",
    title: "证据包",
    description: `返回最小必要、可追溯、带置信度的结构化证据包。${noBody}`,
    permission: "egress",
    hasBody: false,
    params: [
      { name: "day", required: true, type: "string" },
      { name: "maxEntries", required: false, type: "number", min: 1, max: DEFAULT_MAX_ENTRIES }
    ]
  },
  {
    name: "ww_skill_template_get",
    title: "Skill 模板",
    description: "返回六部分总结模板、槽位、必填项与字数限制；不包含任何用户数据",
    permission: "read-probe",
    hasBody: false,
    params: []
  },
  {
    name: "ww_summary_validate",
    title: "校验宿主结果",
    description: "对宿主按 Skill 模板生成的结果执行九维校验；未通过内容不落盘",
    permission: "write",
    hasBody: false,
    params: [
      { name: "packageId", required: true, type: "string" },
      { name: "templateVersion", required: true, type: "string" },
      { name: "sections", required: true, type: "object" }
    ]
  },
  {
    name: "ww_report_export",
    title: "导出报告",
    description: "将已校验的事实层与叙述层原子导出为 HTML / JSON / Markdown；未指定 format 时默认 HTML",
    permission: "egress",
    hasBody: false,
    params: [
      { name: "day", required: true, type: "string" },
      { name: "out", required: true, type: "string" },
      { name: "format", required: false, type: "string", enum: ["markdown", "json", "html"] }
    ]
  },
  {
    name: "ww_pending_manage",
    title: "待确认项",
    description: `查询、确认或忽略待确认项；记录完整性项只改状态，不补造内容。${noBody}`,
    permission: "write",
    hasBody: false,
    params: [
      { name: "day", required: true, type: "string" },
      { name: "type", required: false, type: "string" },
      { name: "action", required: false, type: "string", enum: ["query", "confirm", "ignore"] },
      { name: "id", required: false, type: "string" }
    ]
  },
  {
    name: "ww_evidence_resolve",
    title: "证据回查",
    description: `按引用标识回查会话、消息、时间与脱敏片段。${noBody}`,
    permission: "egress",
    hasBody: false,
    params: [
      { name: "packageId", required: true, type: "string" },
      { name: "evidenceId", required: true, type: "string" }
    ]
  }
];

export function capabilityDeclaration(
  tools: readonly ToolContract[] = TOOL_CONTRACTS,
): CapabilityDeclaration {
  return {
    protocolVersions: MCP_PROTOCOL_VERSIONS,
    contractVersion: MCP_CONTRACT_VERSION,
    sources: SOURCE_TOOL_VALUES,
    reportFormats: ["markdown", "json", "html"],
    evidencePackageMaxBytes: DEFAULT_MAX_BYTES,
    evidencePackageMaxEntries: DEFAULT_MAX_ENTRIES,
    templateVersion: SKILL_TEMPLATE_VERSION,
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      permission: tool.permission,
      hasBody: tool.hasBody,
      allowedParams: tool.params.map((param) => param.name)
    }))
  };
}