import { SetMetadata } from "@nestjs/common";
import type { WorkPulseRoleName } from "@workpulse/shared-types";

export const ROLES_KEY = "roles";

/**
 * Declares which workPulse roles (Section 11 of the BRS) may access a route.
 * Checked by RolesGuard against the roles on the authenticated User record -
 * NOT directly against Keycloak realm roles, since workPulse role assignment
 * (Department Head, Project Manager, Audit, etc.) is domain logic that lives
 * in this app, one level above raw identity.
 *
 * Example: @Roles("DEPARTMENT_HEAD", "SYSTEM_ADMIN")
 */
export const Roles = (...roles: WorkPulseRoleName[]) => SetMetadata(ROLES_KEY, roles);
