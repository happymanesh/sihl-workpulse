import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { SignJWT } from "jose";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { mountTrpc } from "../src/trpc/mount";
import { SYNAPSE_SESSION_COOKIE } from "../src/modules/auth/synapse-session.service";

/**
 * End-to-end proof of the federated identity chain:
 *
 *   Synapse session cookie -> signature verification -> live active-user check
 *   against Synapse -> Synapse role -> workPulse role -> authorisation
 *
 * These tests mint session tokens the same way Synapse's createSession() does,
 * signing with the shared SESSION_SECRET. That is the point: it exercises the
 * real verification path rather than stubbing it out. It is also why this is an
 * e2e test against a local dev secret and never runs against a real deployment.
 *
 * Requires a reachable Synapse directory (SYNAPSE_DATABASE_URL) and the seeded
 * SynapseRoleMap. Skips itself cleanly when either is absent, so a checkout
 * without Synapse access does not report a false failure.
 */

// Real Synapse users, read from user_details. The role each maps to is what
// makes the expectations below meaningful.
const USERS = {
  admin: { uid: 2, username: "Admin001", synapseRole: "ADMIN" }, //        -> SYSTEM_ADMIN
  supportDesk: { uid: 1, username: "Manesh001", synapseRole: "SUPPORT_DESK" }, // -> EMPLOYEE
  client: { uid: 8, username: "Client001", synapseRole: "CLIENT_SELF" }, //     -> unmapped
} as const;

async function mintSession(
  user: { uid: number; username: string },
  opts: { expiresIn?: string; secret?: string } = {},
) {
  const secret = new TextEncoder().encode(opts.secret ?? process.env.SESSION_SECRET!);
  return new SignJWT({
    userUid: user.uid,
    username: user.username,
    fullName: user.username,
    companyCode: "SIHL",
    hierarchyCode: "0200",
    hierarchyName: "Operations",
    roles: [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "8h")
    .sign(secret);
}

const canRun = Boolean(process.env.SESSION_SECRET && process.env.SYNAPSE_DATABASE_URL);
const describeIfConfigured = canRun ? describe : describe.skip;

describeIfConfigured("Synapse federated identity (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Same wiring as main.ts, via the same helper: identity arrives as a
    // cookie, and tRPC is raw Express middleware that Nest's guards never see.
    app.use(cookieParser());
    mountTrpc(app);
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  describe("rejects anything that is not a valid, current Synapse session", () => {
    it("no cookie at all", async () => {
      await request(app.getHttpServer()).get("/employees").expect(401);
    });

    it("a token signed with the wrong secret", async () => {
      const forged = await mintSession(USERS.admin, { secret: "not-the-shared-secret-at-all" });
      await request(app.getHttpServer())
        .get("/employees")
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${forged}`)
        .expect(401);
    });

    it("a correctly signed but expired token", async () => {
      const expired = await mintSession(USERS.admin, { expiresIn: "-1h" });
      await request(app.getHttpServer())
        .get("/employees")
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${expired}`)
        .expect(401);
    });

    it("a valid signature for a user Synapse does not have", async () => {
      const ghost = await mintSession({ uid: 999_999, username: "nobody" });
      await request(app.getHttpServer())
        .get("/employees")
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${ghost}`)
        .expect(401);
    });
  });

  describe("authorises according to the Synapse role, not the token", () => {
    it("SYSTEM_ADMIN reaches /employees and gets data", async () => {
      const token = await mintSession(USERS.admin);
      const res = await request(app.getHttpServer())
        .get("/employees")
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty("name");
      expect(res.body[0]).toHaveProperty("departmentName");
    });

    it("EMPLOYEE is authenticated but forbidden from /employees", async () => {
      // Support Desk maps to EMPLOYEE, which is not in the @Roles list for this
      // route. 403 rather than 401 is the point: identity was established, and
      // it was authorisation that refused.
      const token = await mintSession(USERS.supportDesk);
      await request(app.getHttpServer())
        .get("/employees")
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${token}`)
        .expect(403);
    });

    it("an external client is denied outright, despite a perfectly valid session", async () => {
      // The security property: CLIENT_SELF maps to no workPulse role, so the
      // user is refused at authentication rather than being handed a default.
      // A regression here would silently give customers employee accounts.
      const token = await mintSession(USERS.client);
      await request(app.getHttpServer())
        .get("/employees")
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${token}`)
        .expect(401);
    });
  });

  describe("tRPC enforces the same rules independently of the REST guards", () => {
    it("public procedures need no session", async () => {
      const res = await request(app.getHttpServer()).get("/trpc/meta.ping").expect(200);
      expect(res.body.result.data.json.ok).toBe(true);
    });

    it("protected procedures reject an absent session", async () => {
      const res = await request(app.getHttpServer()).get(
        "/trpc/employee.list?input=" + encodeURIComponent(JSON.stringify({})),
      );
      expect(res.body.error.json.data.code).toBe("UNAUTHORIZED");
    });

    it("protected procedures accept a SYSTEM_ADMIN session", async () => {
      const token = await mintSession(USERS.admin);
      const res = await request(app.getHttpServer())
        .get("/trpc/employee.list?input=" + encodeURIComponent(JSON.stringify({})))
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${token}`)
        .expect(200);

      expect(Array.isArray(res.body.result.data.json)).toBe(true);
      expect(res.body.result.data.json.length).toBeGreaterThan(0);
    });

    it("protected procedures reject an external client", async () => {
      const token = await mintSession(USERS.client);
      const res = await request(app.getHttpServer())
        .get("/trpc/employee.list?input=" + encodeURIComponent(JSON.stringify({})))
        .set("Cookie", `${SYNAPSE_SESSION_COOKIE}=${token}`);
      expect(res.body.error.json.data.code).toBe("UNAUTHORIZED");
    });
  });
});
