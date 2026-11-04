import { createHash } from "node:crypto";
import type { PlainDate } from "../../domain/types.js";

export interface VersionSet {
  readonly dataVersion: string;
  readonly configVersion: string;
  readonly ruleVersion: string;
  readonly templateVersion: string;
  readonly completenessVersion: string;
}

export function bumpVersion(current: VersionSet, key: keyof VersionSet): VersionSet {
  const next = Number.parseInt(current[key], 10);
  return {
    ...current,
    [key]: String(Number.isFinite(next) ? next + 1 : 1)
  };
}

export interface FingerprintInput {
  readonly reportType: "daily" | "weekly";
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly versions: VersionSet;
  readonly rendererVersion: string;
}

export function fingerprintInput(input: FingerprintInput): string {
  return [
    input.reportType,
    input.range.from,
    input.range.to,
    input.versions.dataVersion,
    input.versions.configVersion,
    input.versions.ruleVersion,
    input.versions.templateVersion,
    input.versions.completenessVersion,
    input.rendererVersion
  ].join("|");
}

export function reportFingerprint(input: FingerprintInput): string {
  return createHash("sha256").update(fingerprintInput(input)).digest("hex").slice(0, 24);
}