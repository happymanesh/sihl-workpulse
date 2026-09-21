import type { INestApplication } from "@nestjs/common";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { IdentityService } from "../modules/auth/identity.service";
import { SynapseSessionService } from "../modules/auth/synapse-session.service";
import { createContextFactory } from "./trpc";
import { TrpcService } from "./trpc.service";

/**
 * Mounts the tRPC router onto a Nest application.
 *
 * Shared by main.ts and the e2e tests so both exercise identical wiring - a
 * test that mounted tRPC its own way would prove only that the test works.
 *
 * tRPC runs as raw Express middleware, so Nest's global guards and pipes do NOT
 * apply to it. Its context therefore performs the same Synapse verification the
 * REST guard does, using the same two services resolved from the container. The
 * two transports enforce identity independently rather than one silently
 * inheriting the other.
 */
export function mountTrpc(app: INestApplication): void {
  const trpc = app.get(TrpcService);
  app.use(
    "/trpc",
    createExpressMiddleware({
      router: trpc.appRouter,
      createContext: createContextFactory(app.get(SynapseSessionService), app.get(IdentityService)),
    }),
  );
}
