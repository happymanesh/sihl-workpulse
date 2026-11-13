import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { importSPKI, jwtVerify } from "jose";

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
 * RS256, not HS256. Synapse holds the private key and signs; workPulse holds only the
 * public key and can verify. The distinction matters: a shared HS256 secret would let
 * workPulse mint a valid Synapse session for any user, which it has no business being
 * able to do. Pinned here so a token cannot talk us into a weaker algorithm.
 */
export const SYNAPSE_JWT_ALG = "RS256";

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
  // Derived from importSPKI rather than naming jose's key type directly: that type is
  // KeyLike in jose 5 and CryptoKey in 6, and this survives either.
  private readonly publicKey: ReturnType<typeof importSPKI>;

  constructor(private readonly config: ConfigService) {
    const pem = this.config.get<string>("SESSION_PUBLIC_KEY");
    if (!pem) {
      // Fail at boot, not at the first request. Without the key no request can ever
      // be authenticated, and that should be loud.
      throw new Error(
        "SESSION_PUBLIC_KEY is not set. It is Synapse's RS256 public key - see docs/synapse-integration.md",
      );
    }
    // Accepts a raw PEM or a base64-encoded one; base64 is the practical form because a
    // PEM is multi-line and most hosts' variable editors handle that badly.
    const decoded = pem.includes("-----BEGIN")
      ? pem.trim()
      : Buffer.from(pem.trim(), "base64").toString("utf8");
    // Imported once and reused: key import is the expensive part of RS256 verification.
    this.publicKey = importSPKI(decoded, SYNAPSE_JWT_ALG);
  }

  async verify(token: string): Promise<SynapseSessionPayload> {
    try {
      const { payload } = await jwtVerify(token, await this.publicKey, {
        algorithms: [SYNAPSE_JWT_ALG],
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
