import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Marks a route as not requiring a Keycloak token. Use sparingly - health
 * checks and the Frappe HR inbound webhook (once that exists in Phase 1,
 * secured by its own shared secret instead) are the expected uses, not a
 * general escape hatch.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
