import type { INestApplication } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

/**
 * Response headers and request limits for the API.
 *
 * Kept out of main.ts to keep the bootstrap readable, and because the two are
 * applied deliberately rather than by default: the e2e specs build their own
 * application and do not apply the limits, since a suite that trips its own
 * rate limiter fails for reasons that have nothing to do with the code.
 */

/** Longer in production; short in development so a mistake is cheap to undo. */
const HSTS_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/**
 * Browser-side protections, switched on by response header.
 *
 * Two defaults are deliberately overridden:
 *
 * - crossOriginResourcePolicy. Helmet defaults this to "same-origin", which
 *   tells the browser to refuse responses read from another origin. The web
 *   app and this API are separate origins, so the default would break every
 *   request the moment it shipped - and it would break them in the browser
 *   only, which is exactly the kind of fault that survives a server-side test
 *   run. CORS already decides who may call us.
 *
 * - contentSecurityPolicy. This process serves JSON and file downloads, never
 *   HTML, so a page-oriented CSP buys nothing here; the meaningful control for
 *   an uploaded file is that it downloads rather than renders, which the
 *   attachment controller handles with Content-Disposition. The web app sets
 *   its own CSP for the pages people actually look at.
 */
export function applySecurityHeaders(app: INestApplication): void {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // Browsers ignore this over plain http, so it is safe in development and
      // takes effect the moment the API is served over TLS.
      hsts: { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true },
      referrerPolicy: { policy: "no-referrer" },
      // Nothing here is meant to be framed - the web app embeds no API
      // response - so deny outright rather than helmet's SAMEORIGIN default.
      // This matches what the firm's public site already sends.
      frameguard: { action: "deny" },
    }),
  );
}

/**
 * How a caller is identified for rate limiting.
 *
 * Not by IP alone. Everyone in a SIHL office reaches this through the same
 * public address, so an IP-keyed limit would count the whole firm as one
 * caller and throttle the building the moment a few people worked quickly.
 *
 * Where a session is present its token is used instead, hashed so nothing
 * sensitive is held in the limiter's memory. The token is NOT trusted as
 * identity here - that is the guard's job, and it runs regardless. It is used
 * only to separate one caller from another, and a forged one still fails
 * authentication a moment later.
 */
function callerKey(req: Request): string {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.synapse_session;
  const token = bearer ?? cookie;

  if (token) {
    // A cheap, stable fingerprint. Not a security boundary, just a bucket name.
    let hash = 0;
    for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) | 0;
    return `s:${hash}`;
  }
  // ipKeyGenerator, not req.ip directly: a single IPv6 user is handed a whole /64 and can
  // vary the address per request, so bucketing on the raw value means the limit never
  // binds. express-rate-limit v8 refuses to start rather than let that ship silently —
  // which is how this surfaced: the API threw ERR_ERL_KEY_GEN_IPV6 at bootstrap.
  return `ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
}

const logger = new Logger("RateLimit");

function limiter(name: string, windowMs: number, max: number, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator: callerKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn(`${name} limit hit by ${callerKey(req)} on ${req.method} ${req.originalUrl}`);
      res.status(429).json({
        error: "Too many requests",
        detail: "You have made too many requests in a short time. Wait a moment and try again.",
      });
    },
    ...extra,
  });
}

/**
 * Tells Express how many proxies sit in front of it.
 *
 * Behind a reverse proxy every request arrives from the proxy, so without this
 * the client IP is the proxy's for everyone - which would put every
 * unauthenticated caller in the same rate-limit bucket and make the logs
 * useless. Set TRUST_PROXY to the number of proxies in front of this process
 * (1 for a single nginx or Caddy in front).
 *
 * Off unless configured, deliberately: trusting X-Forwarded-For when nothing
 * strips it lets a caller claim any address they like.
 */
export function applyProxyTrust(app: INestApplication): void {
  const configured = process.env.TRUST_PROXY?.trim();
  if (!configured) return;

  const hops = Number(configured);
  const value = Number.isFinite(hops) && hops > 0 ? hops : configured;
  app.getHttpAdapter().getInstance().set("trust proxy", value);
  Logger.log(`Trusting ${value} proxy hop(s) for client addresses`, "Security");
}

/**
 * Request limits.
 *
 * These are backstops against a runaway client, a stuck retry loop or a flood,
 * not a quota anybody should ever notice. The general limit is deliberately
 * generous: the UI is chatty by design - one screen can fire a dozen tRPC
 * queries - and a limit that interrupts ordinary work would be removed within
 * a week, which is worse than not having one.
 *
 * The tighter limits are on the paths where a single caller can cost the most:
 * speech transcription, file uploads, and the intake endpoint that outside
 * systems post to.
 *
 * Note for deployment: behind a load balancer or reverse proxy, set
 * `app.set("trust proxy", 1)` or every request appears to come from the proxy.
 */
export function applyRateLimits(app: INestApplication): void {
  const minute = 60_000;

  // Costly: each call runs a transcription.
  app.use("/speech", limiter("speech", minute, 20));

  // Costly: each call carries bytes and writes a file.
  app.use("/attachments", limiter("attachments", minute, 60));

  // External systems. Generous enough for a genuine burst of tickets, tight
  // enough that a stuck integration cannot raise work without end.
  app.use("/intake", limiter("intake", minute, 120));

  // Everything else, including the whole tRPC surface.
  app.use(
    limiter("general", minute, 600, {
      // Health checks come from monitoring on a schedule and must never be
      // throttled - a limiter that hides whether the service is up defeats
      // the point of having one.
      skip: (req) => req.path === "/health" || req.path.startsWith("/health/"),
    }),
  );
}
