import assert from "node:assert/strict";
import test from "node:test";
import {
  EnterpriseIdentityService,
  EnterprisePolicy,
  PdfRenderer,
  ReportDistributor,
  WorkWeaveError,
  asPlainDate,
  renderMarkdown
} from "@workweave/core";
import type { FactReport, OrgIdentity } from "@workweave/core";

const day = asPlainDate("2026-11-04");
const report: FactReport = {
  reportType: "daily",
  range: { from: day, to: day },
  dataVersion: "v1",
  generatedAt: "2026-11-04T20:00:00.000Z",
  overview: {
    sessions: 0,
    projects: 0,
    tests: 0,
    failures: 0,
    optimizations: 0,
    aiAnswers: 0,
    confirmed: 0,
    inferred: 0,
    notAdopted: 0,
    undeterminable: 0,
    adoptionRate: null,
    commits: 0,
    researchItems: 0
  },
  adoption: {
    total: 0,
    confirmed: 0,
    inferred: 0,
    notAdopted: 0,
    undeterminable: 0,
    numerator: 0,
    denominator: 0,
    rate: null,
    undeterminableRate: 0,
    reworkCount: 0,
    commitCount: 0,
    revertCount: 0
  },
  research: [],
  projects: [],
  crossProject: [],
  pureConversation: [],
  pending: [],
  evidenceIndex: [],
  completeness: { status: "complete", declarations: [], disabledSources: [] }
};

const identity: OrgIdentity = {
  memberId: "m1",
  tenantId: "t1",
  displayName: "开发者",
  roles: ["member"],
  visibleProjectIds: ["project-a"]
};

test("企业模式要求登录，合法令牌转换为 Principal", async () => {
  const service = new EnterpriseIdentityService({
    requireLogin: true,
    provider: {
      verifyToken: async (token) => (token === "valid" ? identity : undefined)
    }
  });

  await assert.rejects(
    service.authenticate(undefined),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-AUTH-001"
  );
  await assert.rejects(
    service.authenticate("invalid"),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-AUTH-001"
  );

  const result = await service.authenticate("valid");
  assert.equal(result?.memberId, "m1");
  const principal = service.toPrincipal(result!);
  assert.deepEqual(principal.roles, ["member"]);
  assert.deepEqual(principal.visibleProjectIds, ["project-a"]);
});

test("PDF 引擎缺失时给出可读错误且不阻塞 Markdown", async () => {
  const renderer = new PdfRenderer();
  await assert.rejects(
    renderer.render(report),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-RPT-001"
  );
  assert.ok(renderMarkdown(report).includes("今日概览"));

  const withEngine = new PdfRenderer({ render: async () => Buffer.from("%PDF") });
  assert.equal((await withEngine.render(report)).toString(), "%PDF");
});

test("分发失败按上限重试，未授权出口直接拒绝且不发送", async () => {
  const policy = new EnterprisePolicy({
    requireLogin: false,
    allowedPurposes: ["report-delivery", "notification"],
    allowedHosts: ["internal.example"]
  });

  let calls = 0;
  const flaky = new ReportDistributor(policy, async () => {
    calls += 1;
    if (calls < 2) throw new Error("temporary");
  });
  const retried = await flaky.deliver({ channel: "shared-directory", location: "\\\\internal.example\\reports" }, "x");
  assert.equal(retried.ok, true);
  assert.equal(retried.attempts, 2);

  let unauthorizedCalls = 0;
  const guarded = new ReportDistributor(policy, async () => {
    unauthorizedCalls += 1;
  });
  await assert.rejects(
    guarded.deliver({ channel: "intranet-doc-service", location: "https://evil.example/report" }, "x"),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SEC-002"
  );
  assert.equal(unauthorizedCalls, 0);
});