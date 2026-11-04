import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PathGuard, WorkWeaveError } from "@workweave/core";

async function makeTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ww-guard-"));
  await mkdir(join(root, "source", "projects"), { recursive: true });
  await writeFile(join(root, "source", "projects", "a.jsonl"), "{}\n", "utf8");
  await mkdir(join(root, "export"), { recursive: true });
  return root;
}

test("允许采集来源根目录内的普通文件", async () => {
  const root = await makeTree();
  const guard = new PathGuard({ homeDir: root });
  const result = await guard.assertCollectable(join(root, "source", "projects", "a.jsonl"), join(root, "source"));
  assert.ok(result.endsWith("a.jsonl"));
});

test("拒绝穿越来源根目录的路径", async () => {
  const root = await makeTree();
  const guard = new PathGuard({ homeDir: root });
  await assert.rejects(
    guard.assertCollectable(join(root, "source", "..", "export"), join(root, "source")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-005"
  );
});

test("拒绝凭据类硬排除文件", async () => {
  const root = await makeTree();
  await writeFile(join(root, "source", "settings.json"), "{}", "utf8");
  const guard = new PathGuard({ homeDir: root });
  await assert.rejects(
    guard.assertCollectable(join(root, "source", "settings.json"), join(root, "source")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-005"
  );
});

test("拒绝不在导出白名单内的目录", async () => {
  const root = await makeTree();
  const guard = new PathGuard({ homeDir: root, allowedExportRoots: [join(root, "export")] });
  await assert.rejects(
    guard.assertExportable(join(root, "source")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-005"
  );
  const allowed = await guard.assertExportable(join(root, "export"));
  assert.ok(allowed.length > 0);
});

test("拒绝符号链接", async (t) => {
  const root = await makeTree();
  const link = join(root, "source", "projects", "link");
  try {
    await symlink(join(root, "export"), link, "dir");
  } catch {
    t.skip("当前环境不允许创建符号链接");
    return;
  }
  const guard = new PathGuard({ homeDir: root });
  await assert.rejects(
    guard.assertCollectable(link, join(root, "source")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-005"
  );
});