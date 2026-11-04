import { WorkWeaveError } from "../domain/errors.js";
import type { Principal, Role } from "../team/types.js";

export interface OrgIdentity {
  readonly memberId: string;
  readonly tenantId: string;
  readonly displayName?: string;
  readonly roles: readonly Role[];
  readonly visibleProjectIds?: readonly string[];
}

export interface OrgIdentityProvider {
  verifyToken(token: string): Promise<OrgIdentity | undefined>;
}

export interface EnterpriseIdentityOptions {
  readonly requireLogin: boolean;
  readonly provider?: OrgIdentityProvider;
}

export class EnterpriseIdentityService {
  constructor(private readonly options: EnterpriseIdentityOptions) {}

  async authenticate(token?: string): Promise<OrgIdentity | undefined> {
    if (token === undefined || token.trim().length === 0) {
      if (this.options.requireLogin) {
        throw new WorkWeaveError("E-AUTH-001", "enterprise mode requires login");
      }
      return undefined;
    }

    const provider = this.options.provider;
    if (provider === undefined) {
      throw new WorkWeaveError("E-AUTH-001", "no organization identity provider configured");
    }

    const identity = await provider.verifyToken(token);
    if (identity === undefined) {
      throw new WorkWeaveError("E-AUTH-001", "invalid organization identity token");
    }
    return identity;
  }

  toPrincipal(identity: OrgIdentity): Principal {
    return {
      memberId: identity.memberId,
      tenantId: identity.tenantId,
      roles: identity.roles,
      ...(identity.visibleProjectIds !== undefined ? { visibleProjectIds: identity.visibleProjectIds } : {})
    };
  }
}