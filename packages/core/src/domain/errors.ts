import type { ErrorCode } from "./types.js";

export interface ErrorMeta {
  readonly retryable: boolean;
  readonly surface: "tool-response" | "warning" | "report-metadata" | "audit";
  readonly message: string;
}

export const ERROR_META: Readonly<Record<ErrorCode, ErrorMeta>> = {
  "E-SRC-001": { retryable: false, surface: "tool-response", message: "来源记录不可读" },
  "E-SRC-002": { retryable: false, surface: "tool-response", message: "来源记录格式不受支持" },
  "E-SRC-003": { retryable: false, surface: "warning", message: "来源记录存在但不完整" },
  "E-SRC-004": { retryable: true, surface: "tool-response", message: "来源探测暂时失败" },
  "E-SRC-005": { retryable: false, surface: "tool-response", message: "路径越界或包含不允许的链接" },
  "E-CAP-001": { retryable: true, surface: "tool-response", message: "采集资源上限触发" },
  "E-CAP-002": { retryable: false, surface: "warning", message: "单日会话量超出处理上限" },
  "E-CAP-003": { retryable: false, surface: "warning", message: "记录帧损坏，已保留可读内容" },
  "E-CAP-004": { retryable: true, surface: "warning", message: "记录仍在写入，等待下次采集" },
  "E-CLS-001": { retryable: true, surface: "tool-response", message: "归类暂不可用" },
  "E-CLS-002": { retryable: false, surface: "tool-response", message: "归类输出不合规" },
  "E-CLS-003": { retryable: false, surface: "tool-response", message: "归类规则冲突" },
  "E-CLS-004": { retryable: false, surface: "tool-response", message: "归类前置一致性校验失败" },
  "E-EXT-001": { retryable: false, surface: "tool-response", message: "测试结果不明确" },
  "E-EXT-002": { retryable: false, surface: "warning", message: "结论缺少证据" },
  "E-EXT-003": { retryable: false, surface: "tool-response", message: "证据与结论不匹配" },
  "E-FIX-001": { retryable: false, surface: "tool-response", message: "人工修正并发冲突" },
  "E-FIX-002": { retryable: false, surface: "tool-response", message: "规则或证据冲突" },
  "E-FIX-003": { retryable: false, surface: "tool-response", message: "修正对象已失效" },
  "E-RPT-001": { retryable: true, surface: "tool-response", message: "报告生成失败" },
  "E-RPT-002": { retryable: false, surface: "tool-response", message: "目标位置不可写" },
  "E-RPT-003": { retryable: false, surface: "tool-response", message: "报告一致性校验失败" },
  "E-SCH-001": { retryable: true, surface: "tool-response", message: "定时任务连续失败" },
  "E-HOST-001": { retryable: false, surface: "warning", message: "宿主长时间未处理待总结证据包" },
  "E-SUM-001": { retryable: true, surface: "tool-response", message: "宿主生成结果不合规" },
  "E-SUM-002": { retryable: true, surface: "tool-response", message: "宿主生成结果与证据冲突" },
  "E-SUM-003": { retryable: false, surface: "tool-response", message: "宿主未回传生成结果" },
  "E-MCP-001": { retryable: false, surface: "tool-response", message: "协议或模板版本不兼容" },
  "E-MCP-002": { retryable: false, surface: "tool-response", message: "工具调用未授权" },
  "E-MCP-003": { retryable: false, surface: "tool-response", message: "工具参数非法" },
  "E-MCP-004": { retryable: true, surface: "tool-response", message: "工具调用超时" },
  "E-MCP-005": { retryable: false, surface: "tool-response", message: "工具不存在或已弃用" },
  "E-PKG-001": { retryable: false, surface: "tool-response", message: "证据包不存在或已过期" },
  "E-PKG-002": { retryable: false, surface: "tool-response", message: "证据引用不存在" },
  "E-PKG-003": { retryable: false, surface: "tool-response", message: "证据包超出上限" },
  "E-AUTH-001": { retryable: false, surface: "tool-response", message: "身份认证失败" },
  "E-AUTH-002": { retryable: false, surface: "tool-response", message: "权限不足" },
  "E-SEC-001": { retryable: false, surface: "warning", message: "本地加密能力不可用" },
  "E-SEC-002": { retryable: false, surface: "tool-response", message: "分发目标未授权" }
};

export class WorkWeaveError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly detail?: string
  ) {
    super(message ?? ERROR_META[code].message);
    this.name = "WorkWeaveError";
  }

  get retryable(): boolean {
    return ERROR_META[this.code].retryable;
  }
}