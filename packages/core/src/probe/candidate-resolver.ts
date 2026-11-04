import type { ProbeCandidate } from "../domain/models.js";

export interface CandidateResolution {
  readonly adopted?: ProbeCandidate;
  readonly ignored: readonly ProbeCandidate[];
  readonly pendingSwitch: boolean;
}

export function resolveCandidates(candidates: readonly ProbeCandidate[]): CandidateResolution {
  const ordered = [...candidates].sort((a, b) => a.rank - b.rank);
  const adopted = ordered.find((candidate) => candidate.validation === "valid");
  const manual = ordered.filter((candidate) => candidate.layer === "manual");
  const pendingSwitch = manual.length > 0 && manual.every((candidate) => candidate.validation !== "valid");

  return {
    adopted,
    ignored: ordered.filter((candidate) => candidate !== adopted),
    pendingSwitch
  };
}