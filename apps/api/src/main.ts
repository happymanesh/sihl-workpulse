// Must be first: populates process.env from the repo-root .env before the
// Prisma client (constructed at import time) reads DATABASE_URL.
import "./load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { mountTrpc } from "./trpc/mount";
import { applyProxyTrust, applyRateLimits, applySecurityHeaders } from "./security";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log", process.env.NODE_ENV === "development" ? "debug" : "log"],
  });

  // Before the limiter, which keys unauthenticated callers by address.
  applyProxyTrust(app);

  // Headers first, so they are set on every response including the ones that
  // never reach a handler - a 429 or a rejected request should be as well
  // defended as a successful one.
  applySecurityHeaders(app);

  // Identity arrives as the Synapse session cookie, so cookies must be parsed
  // before any guard or tRPC context reads them.
  app.use(cookieParser());

  // After cookieParser, because callers are told apart by their session where
  // they have one, and before the routes so the limits cover tRPC too - tRPC
  // is raw Express middleware and Nest's guards never see it.
  applyRateLimits(app);

  // Reject unknown fields / coerce types at the edge, rather than trusting
  // the frontend - important once RACI/DACI/SLA payloads get more complex.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // credentials:true is required - the browser must send the Synapse cookie.
  // Where both apps share a parent domain this is same-site anyway; the explicit
  // origin keeps split-domain development working.
  app.enableCors({
    origin: process.env.WEB_BASE_URL ?? "http://localhost:3000",
    credentials: true,
  });

  // REST stays for health checks and the integration surface (source-system
  // webhooks, the future command-centre feed); tRPC carries the app's own UI.
  // See mount.ts for why its auth is re-declared rather than inherited.
  mountTrpc(app);

  const port = process.env.API_PORT ?? 4000;
  await app.listen(port);
  Logger.log(`workPulse API listening on port ${port} (REST + /trpc)`, "Bootstrap");
}

bootstrap();
