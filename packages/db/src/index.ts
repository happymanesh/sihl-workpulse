import { PrismaClient } from "@prisma/client";

// Standard Prisma singleton pattern - avoids exhausting the Postgres connection
// pool when Next.js hot-reloads apps/web, and gives apps/api one shared client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
