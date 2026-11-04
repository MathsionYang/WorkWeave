import { join } from "node:path";
import type { Platform, SourceTool } from "../domain/types.js";

export interface PlatformPathCandidate {
  readonly source: SourceTool;
  readonly platform: Platform;
  readonly path: string;
  readonly layer: "platform-default";
}

export interface PlatformPathInput {
  readonly platform: Platform;
  readonly homeDir: string;
  readonly appData?: string;
  readonly localAppData?: string;
}

function win(input: PlatformPathInput, source: SourceTool): readonly string[] {
  const appData = input.appData ?? join(input.homeDir, "AppData", "Roaming");
  const localAppData = input.localAppData ?? join(input.homeDir, "AppData", "Local");
  switch (source) {
    case "codex":
      return [join(input.homeDir, ".codex")];
    case "claude":
      return [join(input.homeDir, ".claude"), join(appData, "Claude"), join(localAppData, "Claude")];
    case "workbuddy":
      return [join(input.homeDir, ".workbuddy"), join(appData, "WorkBuddy"), join(localAppData, "WorkBuddy")];
    case "dsh":
      return [join(input.homeDir, ".dsh")];
  }
}

function darwin(input: PlatformPathInput, source: SourceTool): readonly string[] {
  switch (source) {
    case "codex":
      return [join(input.homeDir, ".codex")];
    case "claude":
      return [join(input.homeDir, ".claude"), join(input.homeDir, "Library", "Application Support", "Claude")];
    case "workbuddy":
      return [join(input.homeDir, ".workbuddy"), join(input.homeDir, "Library", "Application Support", "WorkBuddy")];
    case "dsh":
      return [join(input.homeDir, ".dsh")];
  }
}

function linux(input: PlatformPathInput, source: SourceTool): readonly string[] {
  switch (source) {
    case "codex":
      return [join(input.homeDir, ".codex")];
    case "claude":
      return [join(input.homeDir, ".claude"), join(input.homeDir, ".config", "Claude")];
    case "workbuddy":
      return [join(input.homeDir, ".workbuddy"), join(input.homeDir, ".config", "WorkBuddy")];
    case "dsh":
      return [join(input.homeDir, ".dsh")];
  }
}

export function platformCandidates(source: SourceTool, input: PlatformPathInput): readonly PlatformPathCandidate[] {
  const paths =
    input.platform === "win32"
      ? win(input, source)
      : input.platform === "darwin"
        ? darwin(input, source)
        : linux(input, source);

  return paths.map((path) => ({
    source,
    platform: input.platform,
    path,
    layer: "platform-default"
  }));
}