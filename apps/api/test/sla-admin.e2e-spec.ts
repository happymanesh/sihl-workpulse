import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { EscalationTarget, Priority, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { SlaService } from "../src/modules/sla/sla.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Setting SLA targets.
 *
 * The engine - active time, pausing, most-specific-match, the escalation chain
 * - was complete and covered by sla-core.spec.ts. What did not exist was any
 * way to put a row in front of it, so it ran every half hour over an empty
 * table. These cover the writing, not the clock.
 */

const RUN = `e2e-sla-${Date.now()}`;

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "test-user",
    synapseUserUid: 999,
    username: "tester",
    fullName: "Test User",
    companyCode: "SIHL",
    hierarchyCode: "0200",
    roles: ["SYSTEM_ADMIN"],
    employeeId: null,
    isEmployeeUnlinked: false,
    hiddenNavKeys: [],
    ...overrides,
  } as AuthenticatedUser;
}

const canRun = Boolean(process.env.DATABASE_URL);
const d = canRun ? describe : describe.skip;

d("SLA administration (e2e)", () => {
  let app: INestApplication;
  let sla: SlaService;

  let definitionId: string;
  let complianceTypeId: string;
  const created: string[] = [];

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    sla = app.get(SlaService);

    const compliance = await prisma.taskType.findUnique({ where: { code: "COMPLIANCE" } });
    if (!compliance) throw new Error("Fixtures missing. Run `npm run db:seed` first.");
    complianceTypeId = compliance.id;
  }, 90_000);

  afterAll(async () => {
    if (created.length) {
      await prisma.escalationRule.deleteMany({ where: { slaDefinitionId: { in: created } } });
      await prisma.slaDefinition.deleteMany({ where: { id: { in: created } } });
      await prisma.auditLog.deleteMany({
        where: { entityType: "SlaDefinition", entityId: { in: created } },
      });
    }
    await app?.close();
  }, 60_000);

  describe("targets", () => {
    it("refuses anybody below a Department Head", async () => {
      await expect(
        sla.createDefinition(actor({ roles: ["MANAGER"] }), {
          name: `${RUN} nope`,
          resolutionMinutes: 60,
        }),
      ).rejects.toThrow(/Department Head or System Admin/);
    });

    it("refuses a response target that is not shorter than the resolution", async () => {
      await expect(
        sla.createDefinition(actor(), {
          name: `${RUN} bad`,
          resolutionMinutes: 120,
          responseMinutes: 120,
        }),
      ).rejects.toThrow(/shorter than the resolution/);
    });

    it("creates one scoped to a task type and priority, and audits it", async () => {
      const def = await sla.createDefinition(actor(), {
        name: `${RUN} Critical compliance`,
        resolutionMinutes: 240,
        responseMinutes: 30,
        taskTypeId: complianceTypeId,
        priority: Priority.CRITICAL,
      });
      definitionId = def.id;
      created.push(def.id);

      expect(def.isActive).toBe(true);
      expect(def.departmentId).toBeNull();

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "SlaDefinition", entityId: def.id, action: "created" },
      });
      expect(entry?.afterJson).toMatchObject({ resolutionMinutes: 240, priority: Priority.CRITICAL });
    });

    it("will not extend a target without a reason", async () => {
      await expect(
        sla.updateDefinition(actor(), { id: definitionId, resolutionMinutes: 480 }),
      ).rejects.toThrow(/needs a reason/);
    });

    it("tightens one without demanding a reason", async () => {
      const after = await sla.updateDefinition(actor(), { id: definitionId, resolutionMinutes: 180 });
      expect(after.resolutionMinutes).toBe(180);
    });

    it("extends one with a reason, keeping the old target beside the new", async () => {
      await sla.updateDefinition(actor(), {
        id: definitionId,
        resolutionMinutes: 300,
        reason: `${RUN} exchange widened the filing window`,
      });

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "SlaDefinition", entityId: definitionId, action: "updated" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry?.beforeJson).toMatchObject({ resolutionMinutes: 180 });
      expect(entry?.afterJson).toMatchObject({ resolutionMinutes: 300 });
      expect(entry?.reason).toContain("filing window");
    });
  });

  describe("the escalation chain", () => {
    it("adds levels", async () => {
      await sla.addEscalationRule(actor(), {
        slaDefinitionId: definitionId,
        level: 1,
        thresholdPercent: 50,
        notifyTarget: EscalationTarget.ASSIGNEE,
      });
      await sla.addEscalationRule(actor(), {
        slaDefinitionId: definitionId,
        level: 2,
        thresholdPercent: 100,
        notifyTarget: EscalationTarget.LINE_MANAGER,
        isMutable: false,
      });

      const rules = await prisma.escalationRule.findMany({
        where: { slaDefinitionId: definitionId },
        orderBy: { level: "asc" },
      });
      expect(rules.map((r) => r.thresholdPercent)).toEqual([50, 100]);
      // Notified by relationship, never by name - the chain survives people moving.
      expect(rules[1].notifyTarget).toBe(EscalationTarget.LINE_MANAGER);
    });

    it("refuses a duplicate level", async () => {
      await expect(
        sla.addEscalationRule(actor(), {
          slaDefinitionId: definitionId,
          level: 1,
          thresholdPercent: 75,
          notifyTarget: EscalationTarget.REVIEWER,
        }),
      ).rejects.toThrow(/Level 1 already exists/);
    });

    it("refuses a nonsense threshold", async () => {
      await expect(
        sla.addEscalationRule(actor(), {
          slaDefinitionId: definitionId,
          level: 3,
          thresholdPercent: 0,
          notifyTarget: EscalationTarget.REVIEWER,
        }),
      ).rejects.toThrow(/between 1 and 500/);
    });

    it("removes a level and records that it went", async () => {
      const rule = await prisma.escalationRule.findFirst({
        where: { slaDefinitionId: definitionId, level: 1 },
      });
      await sla.removeEscalationRule(actor(), rule!.id);

      const left = await prisma.escalationRule.count({ where: { slaDefinitionId: definitionId } });
      expect(left).toBe(1);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "SlaDefinition", entityId: definitionId, action: "escalation_level_removed" },
      });
      expect(entry?.beforeJson).toMatchObject({ level: 1 });
    });
  });

  describe("what the engine then sees", () => {
    it("lists the definition with its chain, so a target is readable in one call", async () => {
      const all = await sla.listDefinitions();
      const mine = all.find((d) => d.id === definitionId);

      expect(mine?.escalationRules).toHaveLength(1);
      expect(mine?.taskType?.code).toBe("COMPLIANCE");
    });

    it("stops applying once deactivated", async () => {
      await sla.updateDefinition(actor(), { id: definitionId, isActive: false });

      const all = await sla.listDefinitions();
      expect(all.find((d) => d.id === definitionId)?.isActive).toBe(false);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "SlaDefinition", entityId: definitionId, action: "deactivated" },
      });
      expect(entry).not.toBeNull();
    });
  });
});
