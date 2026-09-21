import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ApprovalStatus, Priority, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { DeskCardActivityService } from "../src/modules/desk-card/desk-card-activity.service";
import { RecurrenceService } from "../src/modules/recurrence/recurrence.service";
import { WorkflowService } from "../src/modules/workflow/workflow.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * The Phase 3 rules that carry the most weight:
 *
 *   - an activity cannot be approved without a Process (TM-FR-088)
 *   - Critical work cannot be approved without an approved Workflow (TM-FR-081)
 *   - approving a workflow requires someone other than its author
 *   - a Task pins the version in force AT GENERATION, and later revisions do
 *     not rewrite it (TM-FR-083)
 *
 * That last one is the whole reason the evidence trail is worth anything.
 */

const RUN = `wf-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function actor(id: string, roles: string[] = ["SYSTEM_ADMIN"]): AuthenticatedUser {
  return {
    id,
    synapseUserUid: 1,
    username: id,
    fullName: id,
    companyCode: "SIHL",
    hierarchyCode: "9999",
    roles,
    employeeId: null,
    isEmployeeUnlinked: false,
  } as AuthenticatedUser;
}

(canRun ? describe : describe.skip)("Workflow versioning and pinning (e2e)", () => {
  let app: INestApplication;
  let workflows: WorkflowService;
  let activities: DeskCardActivityService;
  let recurrence: RecurrenceService;

  let cardId: string;
  let activityId: string;
  let processId: string;
  let policyId: string;

  const author = actor("author-user");
  const approver = actor("approver-user");

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    workflows = app.get(WorkflowService);
    activities = app.get(DeskCardActivityService);
    recurrence = app.get(RecurrenceService);

    const dept = await prisma.department.findFirst();
    const emp = await prisma.employee.findFirst({ where: { isActive: true } });
    const type = await prisma.taskType.findUnique({ where: { code: "COMPLIANCE" } });
    if (!dept || !emp || !type) throw new Error("fixtures missing");

    const policy = await prisma.policy.create({
      data: {
        code: `${RUN}-POL`,
        name: `${RUN} Regulatory reporting policy`,
        ownerEmployeeId: emp.id,
        approverEmployeeId: emp.id,
      },
    });
    policyId = policy.id;

    const process = await prisma.process.create({
      data: {
        code: `${RUN}-PROC`,
        name: `${RUN} Regulatory filing`,
        ownerEmployeeId: emp.id,
        policyId: policy.id,
        status: ApprovalStatus.APPROVED,
      },
    });
    processId = process.id;

    const card = await prisma.deskCard.create({
      data: {
        code: `${RUN}-CARD`,
        name: `${RUN} Officer`,
        departmentId: dept.id,
        status: ApprovalStatus.APPROVED,
        holderEmployeeId: emp.id,
        holderSince: new Date(),
      },
    });
    cardId = card.id;

    const activity = await activities.create(author, {
      deskCardId: card.id,
      title: `${RUN} Monthly filing`,
      taskTypeId: type.id,
      priority: Priority.CRITICAL,
      estimatedMinutes: 90,
      frequency: "MONTHLY",
      dayOfMonth: 22,
      startDate: d("2026-01-01"),
    });
    activityId = activity.id;
  }, 60_000);

  afterAll(async () => {
    const taskIds = (await prisma.task.findMany({ where: { deskCardActivityId: activityId }, select: { id: true } })).map((t) => t.id);
    if (taskIds.length) {
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "Task", entityId: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    }
    const wf = await prisma.workflow.findUnique({ where: { deskCardActivityId: activityId }, select: { id: true } });
    if (wf) {
      const vIds = (await prisma.workflowVersion.findMany({ where: { workflowId: wf.id }, select: { id: true } })).map((v) => v.id);
      await prisma.workflowStep.deleteMany({ where: { workflowVersionId: { in: vIds } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "WorkflowVersion", entityId: { in: vIds } } });
      await prisma.workflowVersion.deleteMany({ where: { workflowId: wf.id } });
      await prisma.workflow.delete({ where: { id: wf.id } });
    }
    await prisma.deskCardActivity.deleteMany({ where: { deskCardId: cardId } });
    await prisma.deskCard.deleteMany({ where: { id: cardId } });
    await prisma.process.deleteMany({ where: { id: processId } });
    await prisma.policy.deleteMany({ where: { id: policyId } });
    await app?.close();
  }, 60_000);

  describe("approval gates", () => {
    it("refuses to approve an activity with no Process", async () => {
      await expect(
        activities.setStatus(author, activityId, ApprovalStatus.APPROVED),
      ).rejects.toThrow(/needs a Process/);
    });

    it("refuses to approve Critical work with no approved workflow, once the Process is set", async () => {
      await prisma.deskCardActivity.update({ where: { id: activityId }, data: { processId } });
      await expect(
        activities.setStatus(author, activityId, ApprovalStatus.APPROVED),
      ).rejects.toThrow(/needs an approved workflow/);
    });
  });

  describe("authoring and approving", () => {
    let v1Id: string;

    it("creates a draft version", async () => {
      const v = await workflows.createDraftVersion(author, activityId, [
        { title: "Pull the trade data extract" },
        { title: "Reconcile against the ledger" },
        { title: "Submit the filing" },
      ]);
      v1Id = v.id;
      expect(v.versionNumber).toBe(1);
      expect(v.status).toBe(ApprovalStatus.DRAFT);
      expect(v.steps).toHaveLength(3);
    });

    it("refuses a second concurrent draft", async () => {
      await expect(
        workflows.createDraftVersion(author, activityId, [{ title: "Another" }]),
      ).rejects.toThrow(/already has a draft/);
    });

    it("will not let the author approve their own workflow", async () => {
      // Four eyes matters more here than almost anywhere: everyone downstream
      // follows this procedure without question.
      await expect(workflows.approveVersion(author, v1Id)).rejects.toThrow(/cannot approve a workflow you authored/);
    });

    it("lets a different person approve it", async () => {
      const v = await workflows.approveVersion(approver, v1Id);
      expect(v.status).toBe(ApprovalStatus.APPROVED);
      expect(v.approvedByUserId).toBe(approver.id);
      expect(v.reviewDueAt).not.toBeNull();
    });

    it("now allows the Critical activity to be approved", async () => {
      const a = await activities.setStatus(author, activityId, ApprovalStatus.APPROVED);
      expect(a.status).toBe(ApprovalStatus.APPROVED);
    });

    it("refuses to edit an approved version", async () => {
      await expect(
        workflows.replaceDraftSteps(author, v1Id, [{ title: "Sneaky edit" }]),
      ).rejects.toThrow(/immutable/);
    });
  });

  describe("version pinning (TM-FR-083)", () => {
    let pinnedVersionId: string;
    let taskId: string;

    it("pins the approved version onto generated tasks", async () => {
      await recurrence.generateDue(d("2026-02-01"));
      const task = await prisma.task.findFirst({
        where: { deskCardActivityId: activityId },
        orderBy: { dueDate: "asc" },
      });
      expect(task).not.toBeNull();
      expect(task!.workflowVersionId).not.toBeNull();
      taskId = task!.id;
      pinnedVersionId = task!.workflowVersionId!;
    });

    it("does NOT rewrite the pin when a later version is approved", async () => {
      // The whole point. An auditor reviewing this task must see the procedure
      // that applied on the day, not whatever it was later revised to.
      const v2 = await workflows.createDraftVersion(author, activityId, [
        { title: "Pull the trade data extract" },
        { title: "Reconcile against the ledger" },
        { title: "Obtain Compliance Head sign-off" },
        { title: "Submit the filing" },
      ]);
      await workflows.approveVersion(approver, v2.id);

      const current = await workflows.currentApprovedVersion(activityId);
      expect(current!.id).toBe(v2.id);
      expect(current!.versionNumber).toBe(2);

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      expect(task!.workflowVersionId).toBe(pinnedVersionId);
      expect(task!.workflowVersionId).not.toBe(v2.id);
    });

    it("retains the superseded version rather than deleting it", async () => {
      const v1 = await prisma.workflowVersion.findUnique({ where: { id: pinnedVersionId } });
      expect(v1).not.toBeNull();
      expect(v1!.status).toBe(ApprovalStatus.RETIRED);
      expect(v1!.supersededAt).not.toBeNull();
      // Its steps survive, so the pinned task still resolves to real content.
      expect(await prisma.workflowStep.count({ where: { workflowVersionId: pinnedVersionId } })).toBe(3);
    });

    it("pins the NEW version onto tasks generated afterwards", async () => {
      await recurrence.generateDue(d("2026-04-01"));
      const later = await prisma.task.findFirst({
        where: { deskCardActivityId: activityId },
        orderBy: { dueDate: "desc" },
      });
      expect(later!.workflowVersionId).not.toBe(pinnedVersionId);
    });
  });

  describe("staleness", () => {
    it("flags a version past its review date but keeps it in force", () => {
      const past = { reviewDueAt: d("2020-01-01") };
      const future = { reviewDueAt: d("2099-01-01") };
      expect(WorkflowService.isStale(past)).toBe(true);
      expect(WorkflowService.isStale(future)).toBe(false);
      expect(WorkflowService.isStale({ reviewDueAt: null })).toBe(false);
    });
  });
});
