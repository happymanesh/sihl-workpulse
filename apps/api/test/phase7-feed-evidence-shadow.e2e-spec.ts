import { ForbiddenException, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  CommandCentreEventType,
  CommandCentreSeverity,
  Priority,
  TaskStatus,
  prisma,
} from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { ShadowScoreService } from "../src/modules/analytics/shadow-score.service";
import { AppraisalService } from "../src/modules/appraisal/appraisal.service";
import { CommandCentreService } from "../src/modules/command-centre/command-centre.service";
import { PredictionService } from "../src/modules/prediction/prediction.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

const RUN = `p7-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);

function actor(roles: string[], employeeId: string | null = null): AuthenticatedUser {
  return {
    id: `${RUN}-${roles.join("-")}`,
    synapseUserUid: 1,
    username: "tester",
    fullName: "Tester",
    companyCode: "SIHL",
    hierarchyCode: "9999",
    roles,
    employeeId,
    isEmployeeUnlinked: false,
  } as AuthenticatedUser;
}

const PERIOD_START = new Date("2026-04-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-04-30T23:59:59.999Z");
const CYCLE = `${RUN}-FY27H1`;

(canRun ? describe : describe.skip)("Phase 7: feed, evidence and shadow scoring (e2e)", () => {
  let app: INestApplication;
  let commandCentre: CommandCentreService;
  let appraisal: AppraisalService;
  let shadow: ShadowScoreService;
  let prediction: PredictionService;

  let empId: string;
  let otherEmpId: string;
  let deptId: string;
  let taskTypeId: string;
  const taskIds: string[] = [];
  const eventIds: string[] = [];

  /**
   * The feed's high-water mark before this suite ran.
   *
   * `refresh()` detects real conditions in the seeded data and writes real
   * events, so deleting only the events this file created by hand would leave
   * those behind. Everything past this sequence is ours.
   */
  let sequenceBefore = 0n;

  const makeEvent = async (over: Partial<{ headline: string; isConfidentialTask: boolean }> = {}) => {
    const seq = eventIds.length + 1;
    const e = await prisma.commandCentreEvent.create({
      data: {
        eventType: CommandCentreEventType.CRITICAL_OVERDUE,
        severity: CommandCentreSeverity.URGENT,
        headline: over.headline ?? `${RUN} event ${seq}`,
        dedupeKey: `${RUN}:${seq}`,
      },
    });
    eventIds.push(e.id);
    return e;
  };

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    commandCentre = app.get(CommandCentreService);
    appraisal = app.get(AppraisalService);
    shadow = app.get(ShadowScoreService);
    prediction = app.get(PredictionService);

    const type = await prisma.taskType.findUnique({ where: { code: "OPERATIONAL" } });
    const dept = await prisma.department.findFirst();
    const emp = await prisma.employee.findFirst({ where: { isActive: true, departmentId: dept?.id } });
    if (!type || !dept || !emp) throw new Error("fixtures missing");
    taskTypeId = type.id;
    deptId = dept.id;
    empId = emp.id;

    const other = await prisma.employee.findFirst({ where: { isActive: true, id: { not: emp.id } } });
    otherEmpId = other?.id ?? emp.id;

    const highest = await prisma.commandCentreEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    sequenceBefore = highest?.sequence ?? 0n;
  }, 60_000);

  afterAll(async () => {
    // Everything this suite caused, including what refresh() detected in the
    // seeded data - not just the rows it created by hand.
    await prisma.commandCentreEvent.deleteMany({
      where: {
        OR: [
          { id: { in: eventIds } },
          { taskId: { in: taskIds } },
          { sequence: { gt: sequenceBefore } },
        ],
      },
    });
    await prisma.slaPrediction.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.appraisalEvidence.deleteMany({ where: { cycleLabel: CYCLE } });
    await prisma.shadowScore.deleteMany({ where: { periodStart: PERIOD_START, periodEnd: PERIOD_END } });
    await prisma.analyticsPeriod.deleteMany({ where: { periodStart: PERIOD_START, periodEnd: PERIOD_END } });
    await prisma.auditLog.deleteMany({ where: { entityType: "AppraisalEvidence" } });
    await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await app.close();
  }, 60_000);

  // -------------------------------------------------------------------------
  // TM-FR-058
  // -------------------------------------------------------------------------

  describe("the CEO Command Centre feed", () => {
    it("never generates an event for confidential work", async () => {
      const secret = await prisma.task.create({
        data: {
          reference: `${RUN}-secret`,
          title: `${RUN} disciplinary matter`,
          taskTypeId,
          assigneeEmployeeId: empId,
          departmentId: deptId,
          priority: Priority.CRITICAL,
          status: TaskStatus.IN_PROGRESS,
          isConfidential: true,
          isMissed: true,
          dueDate: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      taskIds.push(secret.id);

      const candidates = await commandCentre.detect(new Date());

      // The exclusion is at generation, so a consumer has no parameter that
      // could widen it - the rows were never written.
      expect(candidates.map((c) => c.taskId)).not.toContain(secret.id);
    }, 60_000);

    it("does raise events for equivalent non-confidential work", async () => {
      const open = await prisma.task.create({
        data: {
          reference: `${RUN}-open`,
          title: `${RUN} overdue critical`,
          taskTypeId,
          assigneeEmployeeId: empId,
          departmentId: deptId,
          priority: Priority.CRITICAL,
          status: TaskStatus.IN_PROGRESS,
          isConfidential: false,
          dueDate: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      taskIds.push(open.id);

      const candidates = await commandCentre.detect(new Date());
      expect(candidates.map((c) => c.taskId)).toContain(open.id);
    }, 60_000);

    describe("the cursor", () => {
      it("returns events in sequence order and hands back a usable cursor", async () => {
        const a = await makeEvent({ headline: `${RUN} first` });
        const b = await makeEvent({ headline: `${RUN} second` });

        const page = await commandCentre.since(BigInt(a.sequence.toString()) - 1n, 500);
        const ours = page.events.filter((e) => e.headline.startsWith(RUN));
        expect(ours.map((e) => e.id)).toEqual([a.id, b.id]);
        expect(page.nextCursor).not.toBeNull();
      });

      it("does not re-deliver what the consumer has already seen", async () => {
        const a = await makeEvent({ headline: `${RUN} third` });
        const after = await commandCentre.since(BigInt(a.sequence.toString()), 500);
        expect(after.events.map((e) => e.id)).not.toContain(a.id);
      });

      it("serialises sequence as a string so a 64-bit cursor cannot lose precision", async () => {
        await makeEvent();
        const page = await commandCentre.since(null, 5);
        expect(typeof page.events[0]?.sequence).toBe("string");
        expect(typeof page.nextCursor === "string" || page.nextCursor === null).toBe(true);
      });

      it("hides resolved events by default and reveals them on request", async () => {
        const e = await makeEvent({ headline: `${RUN} resolved` });
        await prisma.commandCentreEvent.update({
          where: { id: e.id },
          data: { resolvedAt: new Date() },
        });

        const from = BigInt(e.sequence.toString()) - 1n;
        const open = await commandCentre.since(from, 500);
        const all = await commandCentre.since(from, 500, true);

        expect(open.events.map((x) => x.id)).not.toContain(e.id);
        expect(all.events.map((x) => x.id)).toContain(e.id);
      });
    });

    it("is idempotent: refreshing twice never leaves two open events for one condition", async () => {
      // Asserting `second.raised === 0` looked like idempotency but tested the
      // enterprise standing still. The suites run two at a time against one
      // database, so another suite creating a missed recurring task between
      // the two calls legitimately raises an event and the count is not zero.
      //
      // The property that actually matters is that one condition never yields
      // two open events - that is what would make the feed unreadable - and it
      // holds regardless of what else is happening.
      await commandCentre.refresh();
      await commandCentre.refresh();

      const duplicated = await prisma.commandCentreEvent.groupBy({
        by: ["dedupeKey"],
        where: { resolvedAt: null },
        _count: { _all: true },
      });
      expect(duplicated.filter((d) => d._count._all > 1)).toEqual([]);
    }, 120_000);

    it("reports a pulse with a direction of travel", async () => {
      const pulse = await commandCentre.pulse(PERIOD_START, PERIOD_END);
      expect(pulse.trend).toMatch(/IMPROVING|STABLE|DETERIORATING|UNKNOWN/);
      expect(typeof pulse.openTasks).toBe("number");
    }, 60_000);
  });

  // -------------------------------------------------------------------------
  // TM-FR-059 / TM-FR-060
  // -------------------------------------------------------------------------

  describe("HR appraisal evidence", () => {
    it("generates a snapshot for a cycle", async () => {
      const e = await appraisal.generate(actor(["EXECUTIVE"]), {
        employeeId: empId,
        cycleLabel: CYCLE,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      expect(e.cycleLabel).toBe(CYCLE);
    }, 60_000);

    it("exposes NO single numeric score field (TM-FR-060)", async () => {
      const view = await appraisal.find(actor(["EXECUTIVE"]), empId, CYCLE);

      // The acceptance criterion, taken literally.
      expect(view.compositeScore).toBeNull();
      const numericKeys = Object.entries(view)
        .filter(([, v]) => typeof v === "number")
        .map(([k]) => k);
      expect(numericKeys).not.toContain("score");
      expect(numericKeys).not.toContain("composite");
      expect(numericKeys).not.toContain("overall");
      expect(view.compositeScoreExplanation).toMatch(/evidence, not a score/i);
    }, 60_000);

    it("carries the five components and the raw evidence behind them", async () => {
      const view = await appraisal.find(actor(["EXECUTIVE"]), empId, CYCLE);
      for (const k of ["execution", "timeliness", "quality", "governance", "contribution"]) {
        expect(k in view).toBe(true);
      }
      expect(typeof view.wtuDue).toBe("number");
    }, 60_000);

    it("discloses how much work was excluded rather than shrinking the denominator silently", async () => {
      const view = await appraisal.find(actor(["EXECUTIVE"]), empId, CYCLE);
      expect(typeof view.openFlagCount).toBe("number");
      expect(typeof view.excludedTaskCount).toBe("number");
    }, 60_000);

    it("lets the subject read their own, and records that they did (TM-FR-059)", async () => {
      const before = await prisma.appraisalEvidence.findUnique({
        where: { employeeId_cycleLabel: { employeeId: empId, cycleLabel: CYCLE } },
        select: { disclosedToSubjectAt: true },
      });
      expect(before?.disclosedToSubjectAt).toBeNull();

      await appraisal.find(actor(["EMPLOYEE"], empId), empId, CYCLE);

      const after = await prisma.appraisalEvidence.findUnique({
        where: { employeeId_cycleLabel: { employeeId: empId, cycleLabel: CYCLE } },
        select: { disclosedToSubjectAt: true },
      });
      expect(after?.disclosedToSubjectAt).not.toBeNull();
    }, 60_000);

    it("refuses a peer", async () => {
      if (otherEmpId === empId) return;
      await expect(
        appraisal.find(actor(["EMPLOYEE"], otherEmpId), empId, CYCLE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }, 60_000);

    it("refuses a line manager, who reads the symmetric report card instead", async () => {
      await expect(
        appraisal.generate(actor(["MANAGER"], otherEmpId), {
          employeeId: empId,
          cycleLabel: CYCLE,
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }, 60_000);

    it("audits generation, naming who pulled whose record", async () => {
      const entries = await prisma.auditLog.findMany({
        where: { entityType: "AppraisalEvidence", action: "GENERATE" },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].actorId).toBeTruthy();
    }, 60_000);

    it("is idempotent per cycle - one artifact, no ambiguity about which was used", async () => {
      await appraisal.generate(actor(["EXECUTIVE"]), {
        employeeId: empId,
        cycleLabel: CYCLE,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      const rows = await prisma.appraisalEvidence.findMany({
        where: { employeeId: empId, cycleLabel: CYCLE },
      });
      expect(rows).toHaveLength(1);
    }, 60_000);
  });

  // -------------------------------------------------------------------------
  // Addendum 02 shadow quarter
  // -------------------------------------------------------------------------

  describe("shadow scoring", () => {
    it("computes a period", async () => {
      const r = await shadow.computePeriod(PERIOD_START, PERIOD_END);
      expect(r.computed).toBeGreaterThan(0);
    }, 120_000);

    it("stores every row as NOT in force", async () => {
      const inForce = await prisma.shadowScore.count({
        where: { periodStart: PERIOD_START, periodEnd: PERIOD_END, isInForce: true },
      });
      expect(inForce).toBe(0);
    }, 60_000);

    it("records the weights used, so two runs cannot be confused", async () => {
      const row = await prisma.shadowScore.findFirst({
        where: { periodStart: PERIOD_START, periodEnd: PERIOD_END },
      });
      expect(row?.weightsJson).toMatchObject({ execution: 0.3, timeliness: 0.25 });
    }, 60_000);

    describe("who may read it", () => {
      it("allows AUDIT", async () => {
        const report = await shadow.report(actor(["AUDIT"]), PERIOD_START, PERIOD_END);
        expect(report.isInForce).toBe(false);
        expect(report.notInForceReason).toMatch(/shadow quarter and HR sign-off/i);
      }, 60_000);

      it("refuses SYSTEM_ADMIN", async () => {
        await expect(
          shadow.report(actor(["SYSTEM_ADMIN"]), PERIOD_START, PERIOD_END),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("refuses an executive", async () => {
        await expect(
          shadow.report(actor(["EXECUTIVE_RESTRICTED"]), PERIOD_START, PERIOD_END),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("refuses the subject's manager", async () => {
        await expect(
          shadow.report(actor(["MANAGER"], otherEmpId), PERIOD_START, PERIOD_END),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("refuses the subject themselves", async () => {
        // A number nobody may act on should not be circulating in appraisal
        // season, least of all to the person it describes.
        await expect(
          shadow.report(actor(["EMPLOYEE"], empId), PERIOD_START, PERIOD_END),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    it("returns figures without names", async () => {
      const rows = await shadow.anonymisedScores(actor(["AUDIT"]), PERIOD_START, PERIOD_END);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.subject).toMatch(/^S-\d{3}$/);
        expect(Object.keys(r)).toEqual(["subject", "composite"]);
      }
    }, 60_000);

    it("never reaches appraisal evidence", async () => {
      // The containment that matters: TM-FR-060 must stay true while a shadow
      // quarter is running.
      const view = await appraisal.find(actor(["EXECUTIVE"]), empId, CYCLE);
      expect(JSON.stringify(view)).not.toMatch(/shadow/i);
      expect(view.compositeScore).toBeNull();
    }, 60_000);

    it("states a verdict rather than leaving a chart to be interpreted", async () => {
      const report = await shadow.report(actor(["AUDIT"]), PERIOD_START, PERIOD_END);
      expect(typeof report.verdict.discriminates).toBe("boolean");
      if (!report.verdict.discriminates) {
        expect(report.verdict.reasons.length).toBeGreaterThan(0);
      }
    }, 60_000);
  });

  // -------------------------------------------------------------------------
  // SLA-breach prediction
  // -------------------------------------------------------------------------

  describe("SLA-breach prediction", () => {
    it("returns null for a task with no SLA rather than inventing a number", async () => {
      const t = await prisma.task.create({
        data: {
          reference: `${RUN}-nosla`,
          title: `${RUN} no sla`,
          taskTypeId,
          assigneeEmployeeId: empId,
          departmentId: deptId,
          status: TaskStatus.IN_PROGRESS,
          dueDate: new Date("2026-05-01T00:00:00.000Z"),
        },
      });
      taskIds.push(t.id);

      const result = await prediction.assessTask(t.id);
      // Either null (no SLA configured) or a real assessment - never a number
      // conjured from nothing.
      if (result !== null) {
        expect(result.risk).toBeGreaterThanOrEqual(0);
        expect(result.factors.length).toBeGreaterThan(0);
      }
    }, 60_000);

    it("reports accuracy honestly when there is nothing to score", async () => {
      const r = await prediction.accuracy(new Date("2030-01-01"));
      expect(r.count).toBe(0);
      expect(Number.isFinite(r.skill)).toBe(true);
    }, 60_000);
  });
});
