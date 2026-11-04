import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContractGateway, WorkWeaveRuntime, createRuntimeHandlers } from "@workweave/mcp";
import type { ToolResult } from "@workweave/mcp";
import type { StructuredEvidencePackage } from "@workweave/core";

const HOST = "workbuddy";
const TOKEN = "local-token";
const DAY = "2026-11-04";

function codexLines(): string {
  return [
    JSON.stringify({
      timestamp: `${DAY}T08:00:00.000Z`,
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "codex-1", cwd: "/work/project-a" }
    }),
    JSON.stringify({
      timestamp: `${DAY}T08:01:00.000Z`,
      ordinal: 1,
      type: "response_item",
      payload: {
        type: "message",
        id: "c1",
        role: "user",
        content: [{ type: "text", text: "运行 npm test 修复登录 bug" }]
      }
    }),
    JSON.stringify({
      timestamp: `${DAY}T08:02:00.000Z`,
      ordinal: 2,
      type: "response_item",
      payload: {
        type: "message",
        id: "c2",
        role: "assistant",
        content: [{ type: "text", text: "已完成，测试 1 failed" }]
      }
    })
  ].join("\n");
}

test("MCP 运行时串通探测、采集、归类、证据包、回查与导出", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-mcp-runtime-"));
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "04");
  await mkdir(codexDir, { recursive: true });
  await mkdir(join(home, ".claude", "projects"), { recursive: true });
  await writeFile(join(codexDir, "rollout-2026-11-04T08-00-00-codex-1.jsonl"), codexLines(), "utf8");

  const runtime = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {} });
  const gateway = new ContractGateway({
    expectedHostId: HOST,
    expectedToken: TOKEN,
    handlers: createRuntimeHandlers(runtime)
  });

  const call = async (tool: string, params: Record<string, unknown>, callId: string): Promise<ToolResult> =>
    gateway.invoke({ tool, callId, auth: { hostId: HOST, token: TOKEN }, params });

  const probe = await call("ww_source_probe", { source: "codex" }, "probe-1");
  assert.equal(probe.ok, true);
  const probeData = probe.data as { status: string }[];
  assert.equal(probeData[0]?.status, "discovered");

  const allProbe = await call("ww_source_probe", {}, "probe-all");
  assert.equal(allProbe.ok, true);
  assert.ok((allProbe.data as { status: string }[]).some((item) => item.status === "partially-available"));

  const ingest = await call("ww_source_ingest", { day: DAY }, "ingest-1");
  assert.equal(ingest.ok, true);
  assert.equal((ingest.data as { sessionCount: number }).sessionCount, 1);

  const classify = await call("ww_work_classify", { day: DAY }, "classify-1");
  assert.equal(classify.ok, true);
  assert.equal((classify.data as unknown[]).length, 1);

  const facts = await call("ww_fact_extract", { day: DAY }, "facts-1");
  assert.equal(facts.ok, true);
  assert.ok((facts.data as { tests: unknown[] }).tests.length >= 1);

  const evidence = await call("ww_evidence_package", { day: DAY }, "evidence-1");
  assert.equal(evidence.ok, true);
  const pkg = evidence.data as StructuredEvidencePackage;
  assert.equal(pkg.categories.length, 9);
  const sessionItem = pkg.categories.find((category) => category.key === "sessions")?.items[0];
  assert.ok(sessionItem !== undefined);

  const resolved = await call(
    "ww_evidence_resolve",
    { packageId: pkg.packageId, evidenceId: sessionItem.id },
    "resolve-1"
  );
  assert.equal(resolved.ok, true);

  const pending = await call("ww_pending_manage", { day: DAY, action: "query" }, "pending-1");
  assert.equal(pending.ok, true);
  const pendingItems = pending.data as { id: number; type: string; status: string }[];
  const integrityItem = pendingItems.find((item) => item.type === "record-integrity");
  assert.ok(integrityItem !== undefined);

  const confirmed = await call(
    "ww_pending_manage",
    { day: DAY, action: "confirm", id: String(integrityItem.id) },
    "pending-2"
  );
  assert.equal(confirmed.ok, true);
  assert.ok((confirmed.data as { status: string }[]).some((item) => item.status === "confirmed"));

  const template = await call("ww_skill_template_get", {}, "template-1");
  assert.equal(template.ok, true);
  assert.equal((template.data as { templateVersion: string }).templateVersion, "1.0.0");

  const validation = await call(
    "ww_summary_validate",
    { packageId: pkg.packageId, templateVersion: "1.0.0", sections: {} },
    "validate-1"
  );
  assert.equal(validation.ok, true);
  assert.equal((validation.data as { passed: boolean }).passed, false);

  const out = join(home, "mcp-daily.md");
  const exported = await call("ww_report_export", { day: DAY, out, format: "markdown" }, "export-1");
  assert.equal(exported.ok, true);
  const markdown = await readFile(out, "utf8");
  assert.ok(markdown.includes("## 1. 今日概览"));
  assert.ok(markdown.includes("## 8. 证据索引"));
});