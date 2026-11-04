#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);
const DENY_PACKAGES = [
  "openai",
  "@anthropic-ai/sdk",
  "@anthropic-ai/claude-sdk",
  "@google/generative-ai",
  "@google/genai",
  "cohere-ai",
  "ollama",
  "langchain",
  "@langchain/core"
];

const DENY_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}/i,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /api\.openai\.com/,
  /api\.anthropic\.com/
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-tests" || entry.name === ".git") {
      continue;
    }
    const full = join(dir, entry.name);
    if (full === SELF) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile() && /\.(ts|mjs|js|json)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const failures = [];

const rootPkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
for (const workspace of rootPkg.workspaces ?? []) {
  const pkgPath = join(ROOT, workspace.replace("/*", ""), "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const denied of DENY_PACKAGES) {
      if (denied in deps) {
        failures.push(`${pkgPath}: forbidden model dependency ${denied}`);
      }
    }
  } catch {
    // package may not exist yet
  }
}

for (const file of await walk(ROOT)) {
  const text = await readFile(file, "utf8");
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(text)) {
      failures.push(`${file}: forbidden model credential/endpoint pattern ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error("guard:no-model failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("guard:no-model passed: no model SDKs, endpoints, or API keys detected");