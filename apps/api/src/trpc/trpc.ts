import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { WorkPulseRoleName } from "@workpulse/shared-types";
import superjson from "superjson";
import type { AuthenticatedUser } from "../modules/auth/identity.service";
import type { IdentityService } from "../modules/auth/identity.service";
import { SYNAPSE_SESSION_COOKIE, type SynapseSessionService } from "../modules/auth/synapse-session.service";

export interface TrpcContext {
  user: AuthenticatedUser | null;
}

/**
 * Builds the tRPC context function from Nest-provided services.
 *
 * A factory rather than a free function because tRPC mounts as raw Express
 * middleware, outside Nest's request pipeline - the global guards never run for
 * it. Authentication is therefore performed here, using the same two services
 * the REST guard uses, so the transports cannot diverge on who is calling.
 *
 * Resolution failures produce a null user rather than throwing: publicProcedure
 * must still work for unauthenticated callers, and protectedProcedure below
 * turns null into UNAUTHORIZED.
 */
export function createContextFactory(
  sessionService: SynapseSessionService,
  identityService: IdentityService,
) {
  return async function createContext({ req }: CreateExpressContextOptions): Promise<TrpcContext> {
    const cookies = (req as CreateExpressContextOptions["req"] & { cookies?: Record<string, string> }).cookies;
    const header = req.headers.authorization;
    const token =
      cookies?.[SYNAPSE_SESSION_COOKIE] ??
      (header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined);

    if (!token) return { user: null };

    try {
      const session = await sessionService.verify(token);
      return { user: await identityService.resolve(session) };
    } catch {
      // Invalid or expired. Indistinguishable from absent, on purpose.
      return { user: null };
    }
  };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape }) => shape,
});

export const router = t.router;
export const middleware = t.middleware;

/** No authentication. Use only for genuinely public reads (health, metadata). */
export const publicProcedure = t.procedure;

/** Requires an authenticated caller. Narrows `ctx.user` to non-null downstream. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No valid Synapse session" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Role gate, the tRPC equivalent of `@Roles(...)`. Section 18's
 * confidential-task rules need row-level checks beyond this, which belong in
 * the service layer - this only answers "may this role call this procedure".
 */
export function requireRoles(...allowed: WorkPulseRoleName[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!allowed.some((role) => ctx.user.roles.includes(role))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires one of: ${allowed.join(", ")}`,
      });
    }
    return next();
  });
}
