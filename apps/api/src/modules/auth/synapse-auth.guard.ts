import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { IdentityService } from "./identity.service";
import { SynapseSessionService, SYNAPSE_SESSION_COOKIE } from "./synapse-session.service";

/**
 * Global guard. Establishes identity from the Synapse session cookie and
 * attaches the resolved caller to the request.
 *
 * Fails closed at every step: no cookie, bad signature, deactivated user, or an
 * unreachable Synapse directory all produce 401. There is no degraded mode in
 * which an unauthenticated request proceeds.
 *
 * The cookie is read rather than an Authorization header because the browser
 * carries it automatically from Synapse when both apps share a parent domain
 * (docs/synapse-integration.md 3.1). A bearer header is still honoured for
 * service-to-service callers.
 */
@Injectable()
export class SynapseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SynapseSessionService,
    private readonly identityService: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException("No Synapse session");

    const session = await this.sessionService.verify(token);

    const user = await this.identityService.resolve(session);
    if (!user) {
      // Deactivated in Synapse, or the directory could not confirm they are
      // active. Both are "no", and neither says which to the caller.
      throw new UnauthorizedException("Session is no longer valid");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).workPulseUser = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cookies = (request as any).cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[SYNAPSE_SESSION_COOKIE];
    if (fromCookie) return fromCookie;

    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
    return undefined;
  }
}
