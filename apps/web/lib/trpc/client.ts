import type { inferRouterOutputs } from "@trpc/server";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@workpulse/api/trpc/trpc.service";

/**
 * Typed client for use in Client Components. The AppRouter type comes straight
 * from the API's router definition, so a procedure signature change surfaces
 * as a type error here rather than a runtime 400.
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * What each procedure returns, for typing components that take a row rather
 * than fetching it themselves. Derived from the router, so a shape change
 * surfaces here instead of as an undefined at runtime.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Requests go to the Next dev/prod server and are proxied to the API by the
 * rewrite in next.config.js, keeping them same-origin. That avoids CORS and,
 * more importantly, means the browser never needs to know the API's address -
 * which matters once this is deployed behind an internal load balancer.
 */
export function getTrpcUrl() {
  if (typeof window !== "undefined") return "/api/backend/trpc";
  return `${process.env.API_BASE_URL ?? "http://localhost:4000"}/trpc`;
}
