import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { WorkPulseRoleName } from "@workpulse/shared-types";
import { ROLES_KEY } from "./roles.decorator";
import type { AuthenticatedUser } from "./identity.service";

/**
 * Runs after SynapseAuthGuard, which has already resolved the caller and their
 * effective roles.
 *
 * Kept separate from authentication deliberately: who you are and what you may
 * do are different concerns with different failure modes, and Section 18's
 * confidential-task rules will need row-level checks that live in the service
 * layer rather than here. This guard only answers "may this role call this
 * endpoint at all".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<WorkPulseRoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).workPulseUser as AuthenticatedUser | undefined;
    if (!user) {
      throw new ForbiddenException("No authenticated user on request");
    }

    const hasRole = user.roles.some((r) => requiredRoles.includes(r as WorkPulseRoleName));
    if (!hasRole) {
      throw new ForbiddenException(`Requires one of: ${requiredRoles.join(", ")}`);
    }

    return true;
  }
}
