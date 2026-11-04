import { WorkWeaveError } from "../domain/errors.js";
import type { AuthzAction, AuthzResource, Principal, Role } from "./types.js";

function hasRole(principal: Principal, role: Role): boolean {
  return principal.roles.includes(role);
}

function isAdmin(principal: Principal): boolean {
  return hasRole(principal, "admin") || hasRole(principal, "plugin-admin");
}

export class AuthzService {
  authorize(principal: Principal, action: AuthzAction, resource: AuthzResource): void {
    if (principal.tenantId !== resource.tenantId) {
      throw new WorkWeaveError("E-AUTH-002", "tenant mismatch");
    }

    switch (action) {
      case "manage":
        if (!isAdmin(principal)) throw new WorkWeaveError("E-AUTH-002", "manage requires admin role");
        break;
      case "audit":
        if (!isAdmin(principal) && !hasRole(principal, "auditor")) {
          throw new WorkWeaveError("E-AUTH-002", "audit requires auditor or admin role");
        }
        break;
      case "view-team":
        if (!isAdmin(principal) && !hasRole(principal, "lead") && !hasRole(principal, "auditor")) {
          throw new WorkWeaveError("E-AUTH-002", "team view requires lead, auditor or admin role");
        }
        break;
      case "view-own":
        if (!isAdmin(principal) && resource.memberId !== principal.memberId) {
          throw new WorkWeaveError("E-AUTH-002", "cannot view another member's view");
        }
        break;
      case "view-raw":
        if (!isAdmin(principal) && !hasRole(principal, "auditor") && resource.memberId !== principal.memberId) {
          throw new WorkWeaveError("E-AUTH-002", "raw conversation access denied");
        }
        break;
      case "export":
        if (!isAdmin(principal) && !hasRole(principal, "lead")) {
          throw new WorkWeaveError("E-AUTH-002", "export requires lead or admin role");
        }
        break;
    }

    if (
      resource.projectId !== undefined &&
      principal.visibleProjectIds !== undefined &&
      !principal.visibleProjectIds.includes(resource.projectId)
    ) {
      throw new WorkWeaveError("E-AUTH-002", `project ${resource.projectId} is outside the visible scope`);
    }
  }
}