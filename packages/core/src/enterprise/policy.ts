import { WorkWeaveError } from "../domain/errors.js";

export type EgressPurpose = "report-delivery" | "notification" | "identity";

export interface EnterprisePolicyConfig {
  readonly requireLogin: boolean;
  readonly allowedPurposes: readonly EgressPurpose[];
  readonly allowedHosts?: readonly string[];
  readonly localOnly?: boolean;
}

export interface EnterprisePrincipal {
  readonly memberId: string;
  readonly tenantId: string;
}

export class EnterprisePolicy {
  constructor(private readonly config: EnterprisePolicyConfig) {}

  assertAuthenticated(principal?: EnterprisePrincipal): void {
    if (this.config.requireLogin && principal === undefined) {
      throw new WorkWeaveError("E-AUTH-001", "enterprise mode requires login");
    }
  }

  assertEgress(purpose: EgressPurpose, target: string): void {
    if (!this.config.allowedPurposes.includes(purpose)) {
      throw new WorkWeaveError("E-SEC-002", `egress purpose not allowed: ${purpose}`);
    }

    if (this.config.localOnly === true && !/^(file:|<local>|\\\\|\/|[A-Za-z]:[\\/])/.test(target)) {
      throw new WorkWeaveError("E-SEC-002", `local-only mode rejects external target: ${target}`);
    }

    if (this.config.allowedHosts !== undefined) {
      const allowed = this.config.allowedHosts.some((host) => target.includes(host));
      if (!allowed && /^https?:\/\//.test(target)) {
        throw new WorkWeaveError("E-SEC-002", `external host not allowed: ${target}`);
      }
    }
  }
}