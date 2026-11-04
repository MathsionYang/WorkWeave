#!/usr/bin/env node
import { createInterface } from "node:readline";
import { homedir, platform as osPlatform } from "node:os";
import type { Platform } from "@workweave/core";
import { ContractGateway } from "./gateway.js";
import { McpServer } from "./mcp-server.js";
import { WorkWeaveRuntime, createRuntimeHandlers } from "./handlers.js";

function platformOf(value: string | undefined): Platform {
  if (value === "win32" || value === "darwin" || value === "linux") return value;
  const current = osPlatform();
  return current === "win32" || current === "darwin" ? current : "linux";
}

const hostId = process.env.WORKWEAVE_HOST_ID ?? "workbuddy";
const token = process.env.WORKWEAVE_TOKEN ?? "local-token";
const dbPath = process.env.WORKWEAVE_DB_PATH;

const runtime = new WorkWeaveRuntime({
  homeDir: process.env.WORKWEAVE_HOME ?? homedir(),
  platform: platformOf(process.env.WORKWEAVE_PLATFORM),
  env: process.env,
  ...(dbPath !== undefined && dbPath.length > 0 ? { dbPath } : {})
});

const gateway = new ContractGateway({
  expectedHostId: hostId,
  expectedToken: token,
  handlers: createRuntimeHandlers(runtime)
});

const server = new McpServer(gateway, { hostId, token });

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  if (line.trim().length === 0) return;
  server
    .handle(line)
    .then((response) => {
      if (response !== undefined) {
        process.stdout.write(`${response}\n`);
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    });
});