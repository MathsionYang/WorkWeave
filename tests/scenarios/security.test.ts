import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EnterprisePolicy,
  PathGuard,
  WorkWeaveError
} from "@workweave/core";

test("V-30 依赖清单不包含模型 SDK，localOnly 拒绝外部出口", async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const denied of ["openai", "@anthropic-ai/sdk", "@google/generative-ai", "ollama", "langchain"]) {
    assert.equal(denied in deps, false, `forbidden dependency: ${denied}`);
  }

  const policy = new EnterprisePolicy({ requireLogin: false, allowedPurposes: ["report-delivery"], localOnly: true });
  assert.throws(
    () => policy.assertEgress("report-delivery", "https://api.example.com/report"),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SEC-002"
  );
});

test("V-32 路径穿越、符号链接与导出白名单", async () => {
  const root = await mkdtemp(join(tmpdir(), "ww-v31-"));
  await mkdir(join(root, "source", "projects"), { recursive: true });
  await mkdir(join(root, "outside"), { recursive: true });
  await writeFile(join(root, "source", "projects", "a.jsonl"), "{}\n", "utf8");

  const guard = new PathGuard({ homeDir: root, allowedExportRoots: [join(root, "exports")] });
  await assert.rejects(
    guard.assertCollectable(join(root, "source", "..", "outside"), join(root, "source")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-005"
  );
  await assert.rejects(
    guard.assertExportable(join(root, "outside")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-005"
  );
});

test("V-33 并发同 callId 只执行一次业务处理", async () => {
  const { ContractGateway } = await import("@workweave/mcp");
  let calls = 0;
  const gateway = new ContractGateway({
    expectedHostId: "workbuddy",
    expectedToken: "token",
    handlers: new Map([
      ["ww_pending_manage", async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { updated: 1 };
      }]
    ])
  });
  const invocation = {
    tool: "ww_pending_manage",
    callId: "V-32",
    auth: { hostId: "workbuddy", token: "token" },
    params: { day: "2026-11-04" }
  };
  const [first, second] = await Promise.all([gateway.invoke(invocation), gateway.invoke(invocation)]);
  assert.equal(calls, 1);
  assert.deepEqual(first.data, second.data);
});