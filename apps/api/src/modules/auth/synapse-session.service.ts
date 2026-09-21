import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { jwtVerify } from "jose";

/**
 * Mirrors Synapse's own SessionPayload (src/lib/session.ts). Kept structurally
 * identical on purpose - if Synapse adds a claim, this is the one place that
 * needs to learn about it.
 */
export interface SynapseSessionPayload {
  userUid: number;
  username: string;
  fullName: string;
  companyCode: string;
  hierarchyCode: string;
  hierarchyName: string;
  roles: string[];
}

export const SYNAPSE_SESSION_COOKIE = "synapse_session";

/**
 * Verifies the Synapse session JWT.
 *
 * workPulse is not an identity provider: it issues no tokens, stores no
 * credentials and has no login screen. It only verifies what Synapse minted.
 *
 * Signature verification alone is NOT sufficient to authorise a request - the
 * token stays cryptographically valid for its full 8 hours, so a user
 * deactivated in Synapse would keep working until it expired. SynapseDirectory
 * re-checks isActive on every request, exactly as Synapse's own getSession()
 * does. Never treat a verified token as an authorised one on its own.
 */
@Injectable()
export class SynapseSessionService {
  private readonly logger = new Logger(SynapseSessionService.name);
  private readonly encodedSecret: Uint8Array;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.get<string>("SESSION_SECRET");
    if (!secret) {
      // Fail at boot, not at the first request. A missing shared secret means
      // no request can ever be authenticated, and that should be loud.
      throw new Error(
        "SESSION_SECRET is not set. It must match the value Synapse signs its sessions with - see docs/synapse-integration.md",
      );
    }
    this.encodedSecret = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<SynapseSessionPayload> {
    try {
      const { payload } = await jwtVerify(token, this.encodedSecret, {
        algorithms: ["HS256"],
      });

      const uid = payload.userUid;
      if (typeof uid !== "number") {
        throw new Error("token has no numeric userUid claim");
      }

      return {
        userUid: uid,
        username: String(payload.username ?? ""),
        fullName: String(payload.fullName ?? ""),
        companyCode: String(payload.companyCode ?? ""),
        hierarchyCode: String(payload.hierarchyCode ?? ""),
        hierarchyName: String(payload.hierarchyName ?? ""),
        roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
      };
    } catch (err) {
      // Deliberately opaque to the caller: a verification failure must not
      // reveal whether the signature, the expiry or the shape was wrong.
      this.logger.debug(`Synapse session rejected: ${(err as Error).message}`);
      throw new UnauthorizedException("Invalid or expired Synapse session");
    }
  }
}
