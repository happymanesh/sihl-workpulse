import { Injectable } from "@nestjs/common";
import {
  ApprovalStatus,
  Complexity,
  HandoverItemDisposition,
  HandoverReason,
  WorkPulseRole,
  DaciRole,
  ManualScope,
  Priority,
  ProjectHealth,
  ProjectStatus,
  RaciRole,
  RecurrenceFrequency,
  TaskFlagStatus,
  TaskFlagType,
  TaskStatus,
} from "@workpulse/db";
import { z } from "zod";
import { CalendarService } from "../modules/capacity/calendar.service";
import { CoverageService } from "../modules/governance/coverage.service";
import { ManualService } from "../modules/governance/manual.service";
import { ProjectService } from "../modules/project/project.service";
import { RoleGrantService } from "../modules/auth/role-grant.service";
import { RoleMapService } from "../modules/auth/role-map.service";
import { SlaService } from "../modules/sla/sla.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { FlagService } from "../modules/analytics/flag.service";
import { MisService } from "../modules/analytics/mis.service";
import { ShadowScoreService } from "../modules/analytics/shadow-score.service";
import { AppraisalService } from "../modules/appraisal/appraisal.service";
import { CommandCentreService } from "../modules/command-centre/command-centre.service";
import { PredictionService } from "../modules/prediction/prediction.service";
import { HandoverService } from "../modules/lifecycle/handover.service";
import { WorkflowService } from "../modules/workflow/workflow.service";
import { DeskCardActivityService } from "../modules/desk-card/desk-card-activity.service";
import { DeskCardService } from "../modules/desk-card/desk-card.service";
import { EmployeeService } from "../modules/employee/employee.service";
import { ReferenceService } from "../modules/reference/reference.service";
import { transitionMap } from "../modules/task/task-lifecycle";
import { TaskService } from "../modules/task/task.service";
import { protectedProcedure, publicProcedure, requireRoles, router } from "./trpc";

const MANAGEMENT_ROLES = [
  "SYSTEM_ADMIN",
  "MANAGER",
  "DEPARTMENT_HEAD",
  "EXECUTIVE",
  "EXECUTIVE_RESTRICTED",
] as const;

const GOVERNANCE_ROLES = ["SYSTEM_ADMIN", "DEPARTMENT_HEAD"] as const;

/**
 * Builds the tRPC router from injected Nest services.
 *
 * Routers are assembled here rather than as free-standing modules so they go
 * through Nest's DI container. That is what keeps the cross-cutting rules in
 * CLAUDE.md enforceable: a procedure calls a service, and the service is where
 * AuditService.record() and the business rules live. A procedure must never
 * reach for Prisma directly.
 */
@Injectable()
export class TrpcService {
  readonly appRouter: ReturnType<TrpcService["buildRouter"]>;

  constructor(
    private readonly employeeService: EmployeeService,
    private readonly deskCardService: DeskCardService,
    private readonly activityService: DeskCardActivityService,
    private readonly taskService: TaskService,
    private readonly referenceService: ReferenceService,
    private readonly calendarService: CalendarService,
    private readonly workflowService: WorkflowService,
    private readonly coverageService: CoverageService,
    private readonly manualService: ManualService,
    private readonly projectService: ProjectService,
    private readonly slaService: SlaService,
    private readonly handoverService: HandoverService,
    private readonly misService: MisService,
    private readonly analyticsService: AnalyticsService,
    private readonly flagService: FlagService,
    private readonly commandCentreService: CommandCentreService,
    private readonly predictionService: PredictionService,
    private readonly appraisalService: AppraisalService,
    private readonly shadowScoreService: ShadowScoreService,
    private readonly roleGrantService: RoleGrantService,
    private readonly roleMapService: RoleMapService,
  ) {
    this.appRouter = this.buildRouter();
  }

  private buildRouter() {
    return router({
      meta: router({
        ping: publicProcedure.query(() => ({ ok: true as const, at: new Date() })),
        /** Who the caller is, as workPulse resolved them from the Synapse session. */
        me: protectedProcedure.query(({ ctx }) => ctx.user),
      }),

      reference: router({
        taskTypes: protectedProcedure.query(() => this.referenceService.taskTypes()),
        departments: protectedProcedure.query(() => this.referenceService.departments()),
        /** The lifecycle transition table, so the UI never offers an illegal move. */
        taskTransitions: protectedProcedure.query(() => transitionMap()),
      }),

      employee: router({
        list: requireRoles(...MANAGEMENT_ROLES)
          .input(
            z
              .object({ departmentId: z.string().optional(), activeOnly: z.boolean().default(true) })
              .default({ activeOnly: true }),
          )
          .query(({ input }) => this.employeeService.list(input)),

        byId: requireRoles(...MANAGEMENT_ROLES)
          .input(z.object({ id: z.string() }))
          .query(({ input }) => this.employeeService.findById(input.id)),
      }),

      deskCard: router({
        list: requireRoles(...MANAGEMENT_ROLES)
          .input(
            z
              .object({ departmentId: z.string().optional(), includeRetired: z.boolean().default(false) })
              .default({ includeRetired: false }),
          )
          .query(({ input }) => this.deskCardService.list(input)),

        byId: protectedProcedure
          .input(z.object({ id: z.string() }))
          .query(({ input }) => this.deskCardService.findById(input.id)),

        /** The caller's own desk card. Every employee may see their own. */
        mine: protectedProcedure.query(({ ctx }) => this.deskCardService.findMine(ctx.user)),

        create: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              code: z.string().min(2).max(40),
              name: z.string().min(2).max(160),
              description: z.string().max(2000).optional(),
              departmentId: z.string(),
            }),
          )
          .mutation(({ ctx, input }) => this.deskCardService.create(ctx.user, input)),

        setStatus: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              id: z.string(),
              status: z.nativeEnum(ApprovalStatus),
              reason: z.string().max(1000).optional(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.deskCardService.setStatus(ctx.user, input.id, input.status, input.reason),
          ),

        transferHolder: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              deskCardId: z.string(),
              toEmployeeId: z.string(),
              reason: z.string().min(3).max(1000),
            }),
          )
          .mutation(({ ctx, input }) => this.deskCardService.transferHolder(ctx.user, input)),

        acknowledge: protectedProcedure
          .input(z.object({ id: z.string() }))
          .mutation(({ ctx, input }) => this.deskCardService.acknowledge(ctx.user, input.id)),
      }),

      activity: router({
        create: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              deskCardId: z.string(),
              title: z.string().min(2).max(200),
              description: z.string().max(2000).optional(),
              taskTypeId: z.string(),
              priority: z.nativeEnum(Priority),
              estimatedMinutes: z.number().int().positive(),
              frequency: z.nativeEnum(RecurrenceFrequency).nullish(),
              interval: z.number().int().positive().default(1),
              daysOfWeek: z.array(z.number().int().min(1).max(7)).default([]),
              dayOfMonth: z.number().int().min(1).max(31).nullish(),
              leadTimeDays: z.number().int().min(0).default(0),
              startDate: z.date().nullish(),
              endDate: z.date().nullish(),
            }),
          )
          .mutation(({ ctx, input }) => this.activityService.create(ctx.user, input)),

        /** TM-FR-076 - governed, and the reason is mandatory at the edge too. */
        amendEstimatedMinutes: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              activityId: z.string(),
              estimatedMinutes: z.number().int().positive(),
              reason: z.string().min(3).max(1000),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.activityService.amendEstimatedMinutes(
              ctx.user,
              input.activityId,
              input.estimatedMinutes,
              input.reason,
            ),
          ),

        setStatus: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              activityId: z.string(),
              status: z.nativeEnum(ApprovalStatus),
              reason: z.string().max(1000).optional(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.activityService.setStatus(ctx.user, input.activityId, input.status, input.reason),
          ),

        setPaused: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              activityId: z.string(),
              isPaused: z.boolean(),
              reason: z.string().max(1000).optional(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.activityService.setPaused(ctx.user, input.activityId, input.isPaused, input.reason),
          ),

        setActive: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              activityId: z.string(),
              isActive: z.boolean(),
              reason: z.string().max(1000).optional(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.activityService.setActive(ctx.user, input.activityId, input.isActive, input.reason),
          ),
      }),

      sla: router({
        /** Null when no definition covers this task - not all work is tracked. */
        forTask: protectedProcedure
          .input(z.object({ taskId: z.string() }))
          .query(({ input }) => this.slaService.assess(input.taskId)),
      }),

      /**
       * Handover: exits, internal transfers and role changes.
       *
       * One router, because the scan is the same and only the rules about what
       * moves differ. Two would drift.
       */
      handover: router({
        get: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(z.object({ employeeId: z.string() }))
          .query(({ input }) => this.handoverService.get(input.employeeId)),

        history: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(z.object({ employeeId: z.string() }))
          .query(({ input }) => this.handoverService.history(input.employeeId)),

        build: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(
            z.object({
              employeeId: z.string(),
              reason: z.nativeEnum(HandoverReason).default(HandoverReason.EXIT),
              effectiveDate: z.date().optional(),
              toDepartmentId: z.string().optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.handoverService.build(ctx.user, input)),

        setDisposition: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(
            z.object({
              itemId: z.string(),
              disposition: z.nativeEnum(HandoverItemDisposition),
              reason: z.string().max(500).optional(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.handoverService.setDisposition(ctx.user, input.itemId, input.disposition, input.reason),
          ),

        transferItem: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(z.object({ itemId: z.string(), toEmployeeId: z.string() }))
          .mutation(({ ctx, input }) =>
            this.handoverService.transferItem(ctx.user, input.itemId, input.toEmployeeId),
          ),

        /** TM-FR-028: one side of an internal transfer's dual sign-off. */
        approve: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(z.object({ employeeId: z.string(), side: z.enum(["RELEASING", "RECEIVING"]) }))
          .mutation(({ ctx, input }) => this.handoverService.approve(ctx.user, input.employeeId, input.side)),

        complete: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER")
          .input(z.object({ employeeId: z.string(), overrideReason: z.string().max(1000).optional() }))
          .mutation(({ ctx, input }) =>
            this.handoverService.complete(ctx.user, input.employeeId, input.overrideReason),
          ),
      }),

      project: router({
        list: protectedProcedure.query(() => this.projectService.list()),

        byId: protectedProcedure
          .input(z.object({ id: z.string() }))
          .query(({ input }) => this.projectService.byId(input.id)),

        create: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "MANAGER")
          .input(
            z.object({
              code: z.string().min(2).max(40),
              name: z.string().min(2).max(160),
              description: z.string().max(2000).optional(),
              ownerEmployeeId: z.string(),
              sponsorEmployeeId: z.string().optional(),
              projectManagerEmployeeId: z.string(),
              startDate: z.date().optional(),
              targetEndDate: z.date().optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.projectService.create(ctx.user, input)),

        setStatus: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "MANAGER")
          .input(z.object({ id: z.string(), status: z.nativeEnum(ProjectStatus), reason: z.string().max(1000).optional() }))
          .mutation(({ ctx, input }) => this.projectService.setStatus(ctx.user, input.id, input.status, input.reason)),

        recalculateHealth: protectedProcedure
          .input(z.object({ id: z.string() }))
          .mutation(({ input }) => this.projectService.recalculateHealth(input.id)),

        overrideHealth: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "MANAGER")
          .input(
            z.object({
              id: z.string(),
              health: z.nativeEnum(ProjectHealth).nullable(),
              reason: z.string().max(1000).default(""),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.projectService.overrideHealth(ctx.user, input.id, input.health, input.reason),
          ),

        assignRaci: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "MANAGER")
          .input(
            z.object({
              projectId: z.string(),
              employeeId: z.string(),
              role: z.nativeEnum(RaciRole),
              replaceAccountable: z.boolean().default(false),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.projectService.assignRaci(
              ctx.user,
              input.projectId,
              input.employeeId,
              input.role,
              input.replaceAccountable,
            ),
          ),

        removeRaci: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "MANAGER")
          .input(z.object({ assignmentId: z.string() }))
          .mutation(({ ctx, input }) => this.projectService.removeRaci(ctx.user, input.assignmentId)),

        createDecision: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "MANAGER")
          .input(
            z.object({
              projectId: z.string().optional(),
              title: z.string().min(2).max(200),
              description: z.string().max(4000).optional(),
              assignments: z
                .array(z.object({ employeeId: z.string(), role: z.nativeEnum(DaciRole) }))
                .min(1)
                .max(20),
            }),
          )
          .mutation(({ ctx, input }) => this.projectService.createDecision(ctx.user, input)),

        /** Only the named Approver succeeds here - enforced in the service. */
        decide: protectedProcedure
          .input(
            z.object({
              decisionId: z.string(),
              outcome: z.string().min(3).max(2000),
              approve: z.boolean(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.projectService.decide(ctx.user, input.decisionId, input.outcome, input.approve),
          ),

        addDependency: protectedProcedure
          .input(z.object({ predecessorTaskId: z.string(), successorTaskId: z.string() }))
          .mutation(({ ctx, input }) =>
            this.projectService.addDependency(ctx.user, input.predecessorTaskId, input.successorTaskId),
          ),

        removeDependency: protectedProcedure
          .input(z.object({ dependencyId: z.string() }))
          .mutation(({ ctx, input }) => this.projectService.removeDependency(ctx.user, input.dependencyId)),
      }),

      workflow: router({
        forActivity: protectedProcedure
          .input(z.object({ activityId: z.string() }))
          .query(({ input }) => this.workflowService.forActivity(input.activityId)),

        current: protectedProcedure
          .input(z.object({ activityId: z.string() }))
          .query(({ input }) => this.workflowService.currentApprovedVersion(input.activityId)),

        createDraft: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              activityId: z.string(),
              steps: z
                .array(
                  z.object({
                    title: z.string().min(2).max(300),
                    expectedMinutes: z.number().int().positive().optional(),
                    attachmentUrls: z.array(z.string().url()).max(10).optional(),
                  }),
                )
                .min(1)
                .max(60),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.workflowService.createDraftVersion(ctx.user, input.activityId, input.steps),
          ),

        editDraft: requireRoles(...GOVERNANCE_ROLES)
          .input(
            z.object({
              versionId: z.string(),
              steps: z
                .array(
                  z.object({
                    title: z.string().min(2).max(300),
                    expectedMinutes: z.number().int().positive().optional(),
                    attachmentUrls: z.array(z.string().url()).max(10).optional(),
                  }),
                )
                .min(1)
                .max(60),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.workflowService.replaceDraftSteps(ctx.user, input.versionId, input.steps),
          ),

        approve: requireRoles(...GOVERNANCE_ROLES)
          .input(z.object({ versionId: z.string() }))
          .mutation(({ ctx, input }) => this.workflowService.approveVersion(ctx.user, input.versionId)),
      }),

      governance: router({
        coverage: requireRoles(...MANAGEMENT_ROLES, "AUDIT").query(() => this.coverageService.allProcesses()),

        processCoverage: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ processId: z.string() }))
          .query(({ input }) => this.coverageService.forProcess(input.processId)),

        orphans: requireRoles(...MANAGEMENT_ROLES, "AUDIT").query(() => this.coverageService.orphans()),

        manuals: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ scopeType: z.nativeEnum(ManualScope).optional(), scopeId: z.string().optional() }).default({}))
          .query(({ input }) => this.manualService.list(input.scopeType, input.scopeId)),

        manual: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ id: z.string() }))
          .query(({ input }) => this.manualService.byId(input.id)),

        generateManual: requireRoles(...GOVERNANCE_ROLES)
          .input(z.object({ scopeType: z.nativeEnum(ManualScope), scopeId: z.string() }))
          .mutation(({ ctx, input }) =>
            this.manualService.generate(ctx.user, input.scopeType, input.scopeId),
          ),
      }),

      calendar: router({
        blocks: protectedProcedure
          .input(z.object({ from: z.date(), to: z.date(), employeeId: z.string().optional() }))
          .query(({ ctx, input }) => this.calendarService.listBlocks(ctx.user, input)),

        createBlock: protectedProcedure
          .input(
            z.object({
              taskId: z.string().optional(),
              title: z.string().max(200).optional(),
              startAt: z.date(),
              endAt: z.date(),
              employeeId: z.string().optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.calendarService.createBlock(ctx.user, input)),

        deleteBlock: protectedProcedure
          .input(z.object({ id: z.string() }))
          .mutation(({ ctx, input }) => this.calendarService.deleteBlock(ctx.user, input.id)),

        /** The caller's own utilisation for a given week. */
        myUtilisation: protectedProcedure
          .input(z.object({ weekOf: z.date().optional() }).default({}))
          .query(({ ctx, input }) =>
            ctx.user.employeeId
              ? this.calendarService.utilisationFor(ctx.user.employeeId, input.weekOf ?? new Date())
              : null,
          ),

        teamWorkload: requireRoles("SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD")
          .input(z.object({ departmentId: z.string().optional() }).default({}))
          .query(({ ctx, input }) => this.calendarService.teamWorkload(ctx.user, input.departmentId)),

        setBudget: requireRoles("SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD")
          .input(z.object({ employeeId: z.string(), weeklyMinutes: z.number().int().positive() }))
          .mutation(({ ctx, input }) =>
            this.calendarService.setBudget(ctx.user, input.employeeId, input.weeklyMinutes),
          ),
      }),

      task: router({
        mine: protectedProcedure
          .input(z.object({ includeClosed: z.boolean().default(false) }).default({ includeClosed: false }))
          .query(({ ctx, input }) => this.taskService.findMine(ctx.user, input)),

        byId: protectedProcedure
          .input(z.object({ id: z.string() }))
          .query(({ ctx, input }) => this.taskService.findById(ctx.user, input.id)),

        create: protectedProcedure
          .input(
            z.object({
              title: z.string().min(2).max(200),
              description: z.string().max(4000).optional(),
              taskTypeId: z.string(),
              priority: z.nativeEnum(Priority),
              assigneeEmployeeId: z.string(),
              reviewerEmployeeId: z.string().optional(),
              departmentId: z.string().optional(),
              dueDate: z.date(),
              estimatedMinutes: z.number().int().positive().optional(),
              complexity: z.nativeEnum(Complexity).optional(),
              checklist: z.array(z.string().min(1).max(300)).max(50).optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.taskService.create(ctx.user, input)),

        transition: protectedProcedure
          .input(
            z.object({
              taskId: z.string(),
              to: z.nativeEnum(TaskStatus),
              reason: z.string().max(1000).optional(),
              blockedReason: z.string().max(1000).optional(),
              blockingOwnerEmployeeId: z.string().optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.taskService.transition(ctx.user, input)),

        setChecklistItem: protectedProcedure
          .input(
            z.object({
              itemId: z.string(),
              isDone: z.boolean().optional(),
              waivedReason: z.string().max(1000).optional(),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.taskService.setChecklistItem(ctx.user, input.itemId, {
              isDone: input.isDone,
              waivedReason: input.waivedReason,
            }),
          ),
      }),
      mis: router({
        /** Level 1. Scoped to what the caller may see; the scope is disclosed. */
        enterprise: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            this.misService.enterprise(ctx.user, input.periodStart, input.periodEnd),
          ),

        byDepartment: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            this.misService.byDepartment(ctx.user, input.periodStart, input.periodEnd),
          ),

        /** Level 3. The service re-checks department access; drilling is not a bypass. */
        byEmployee: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ departmentId: z.string(), periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            this.misService.byEmployee(ctx.user, input.departmentId, input.periodStart, input.periodEnd),
          ),

        /** Level 4. Every figure above is drillable to the tasks behind it. */
        tasks: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(
            z.object({
              departmentId: z.string().optional(),
              employeeId: z.string().optional(),
              periodStart: z.date(),
              periodEnd: z.date(),
            }),
          )
          .query(({ ctx, input }) =>
            this.misService.tasksFor(
              ctx.user,
              { departmentId: input.departmentId, employeeId: input.employeeId },
              input.periodStart,
              input.periodEnd,
            ),
          ),
      }),

      analytics: router({
        /**
         * The caller's own report card. protectedProcedure, not a role gate:
         * every employee may see their own numbers, and sees exactly what their
         * manager and HR see.
         */
        myReportCard: protectedProcedure
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            ctx.user.employeeId
              ? this.analyticsService.reportCard(
                  ctx.user,
                  ctx.user.employeeId,
                  input.periodStart,
                  input.periodEnd,
                )
              : null,
          ),

        /** Someone else's. The service decides standing and throws if there is none. */
        reportCard: protectedProcedure
          .input(z.object({ employeeId: z.string(), periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            this.analyticsService.reportCard(
              ctx.user,
              input.employeeId,
              input.periodStart,
              input.periodEnd,
            ),
          ),

        teamPeriods: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(
            z.object({
              employeeIds: z.array(z.string()).min(1).max(200),
              periodStart: z.date(),
              periodEnd: z.date(),
            }),
          )
          .query(({ ctx, input }) =>
            this.analyticsService.teamPeriods(
              ctx.user,
              input.employeeIds,
              input.periodStart,
              input.periodEnd,
            ),
          ),

        /** On-demand recompute, e.g. after a flag is dismissed. */
        recompute: requireRoles("SYSTEM_ADMIN", "DEPARTMENT_HEAD")
          .input(z.object({ employeeId: z.string(), periodStart: z.date(), periodEnd: z.date() }))
          .mutation(({ input }) =>
            this.analyticsService.computeFor(input.employeeId, input.periodStart, input.periodEnd),
          ),
      }),

      flag: router({
        /** Flags raised about the caller. Visible to them because they may contest them. */
        mine: protectedProcedure.query(({ ctx }) =>
          ctx.user.employeeId
            ? this.flagService.list(ctx.user, { subjectEmployeeId: ctx.user.employeeId })
            : [],
        ),

        list: protectedProcedure
          .input(
            z
              .object({
                status: z.nativeEnum(TaskFlagStatus).optional(),
                subjectEmployeeId: z.string().optional(),
                flagType: z.nativeEnum(TaskFlagType).optional(),
              })
              .default({}),
          )
          .query(({ ctx, input }) => this.flagService.list(ctx.user, input)),

        /** Uphold or dismiss. A note is required in both directions. */
        review: protectedProcedure
          .input(
            z.object({
              flagId: z.string(),
              decision: z.enum(["ACCEPT", "DISMISS"]),
              note: z.string().min(1).max(2000),
            }),
          )
          .mutation(({ ctx, input }) =>
            this.flagService.review(ctx.user, input.flagId, input.decision, input.note),
          ),
      }),

      commandCentre: router({
        /** Enterprise headline figures with direction of travel (TM-FR-058). */
        pulse: requireRoles("EXECUTIVE", "EXECUTIVE_RESTRICTED", "AUDIT", "SYSTEM_ADMIN")
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .query(({ input }) =>
            this.commandCentreService.pulse(input.periodStart, input.periodEnd),
          ),

        /**
         * The event stream. The cursor is a string because `sequence` is 64-bit
         * and a cursor that lost precision would skip events silently.
         */
        events: requireRoles("EXECUTIVE", "EXECUTIVE_RESTRICTED", "AUDIT", "SYSTEM_ADMIN")
          .input(
            z
              .object({
                since: z.string().optional(),
                limit: z.number().int().min(1).max(500).default(100),
                includeResolved: z.boolean().default(false),
              })
              .default({ limit: 100, includeResolved: false }),
          )
          .query(({ input }) =>
            this.commandCentreService.since(
              input.since ? BigInt(input.since) : null,
              input.limit,
              input.includeResolved,
            ),
          ),

        /** On-demand refresh, for when a CEO is looking at it right now. */
        refresh: requireRoles("EXECUTIVE", "EXECUTIVE_RESTRICTED", "SYSTEM_ADMIN")
          .mutation(() => this.commandCentreService.refresh()),
      }),

      prediction: router({
        /** Highest-risk open work, for a supervisor's morning triage. */
        atRisk: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(
            z
              .object({ limit: z.number().int().min(1).max(100).default(25), departmentId: z.string().optional() })
              .default({ limit: 25 }),
          )
          .query(({ input }) => this.predictionService.atRisk(input.limit, input.departmentId)),

        /** One task's risk, with the factors that produced it. */
        forTask: protectedProcedure
          .input(z.object({ taskId: z.string() }))
          .query(({ input }) => this.predictionService.assessTask(input.taskId)),

        /**
         * How the model has actually performed. Deliberately available to every
         * role that can see a prediction: anyone asked to act on a risk estimate
         * is entitled to know whether it has been any good.
         */
        accuracy: requireRoles(...MANAGEMENT_ROLES, "AUDIT")
          .input(z.object({ since: z.date().optional() }).default({}))
          .query(({ input }) => this.predictionService.accuracy(input.since)),
      }),

      appraisal: router({
        /**
         * Generate a cycle snapshot. HR, Audit or an executive only - a line
         * manager reads evidence through the symmetric report card instead.
         */
        generate: protectedProcedure
          .input(
            z.object({
              employeeId: z.string(),
              cycleLabel: z.string().min(1).max(40),
              periodStart: z.date(),
              periodEnd: z.date(),
            }),
          )
          .mutation(({ ctx, input }) => this.appraisalService.generate(ctx.user, input)),

        generateForDepartment: protectedProcedure
          .input(
            z.object({
              departmentId: z.string(),
              cycleLabel: z.string().min(1).max(40),
              periodStart: z.date(),
              periodEnd: z.date(),
            }),
          )
          .mutation(({ ctx, input }) => this.appraisalService.generateForDepartment(ctx.user, input)),

        /** One snapshot. The subject may always read their own (TM-FR-059). */
        find: protectedProcedure
          .input(z.object({ employeeId: z.string(), cycleLabel: z.string() }))
          .query(({ ctx, input }) =>
            this.appraisalService.find(ctx.user, input.employeeId, input.cycleLabel),
          ),

        /** The caller's own, for the cycle HR has opened. */
        mine: protectedProcedure
          .input(z.object({ cycleLabel: z.string() }))
          .query(({ ctx, input }) =>
            ctx.user.employeeId
              ? this.appraisalService.find(ctx.user, ctx.user.employeeId, input.cycleLabel)
              : null,
          ),

        listCycle: protectedProcedure
          .input(z.object({ cycleLabel: z.string() }))
          .query(({ ctx, input }) => this.appraisalService.listCycle(ctx.user, input.cycleLabel)),
      }),

      /**
       * Addendum 02 shadow quarter. AUDIT only - see ShadowScoreService for why
       * the subject, their manager, HR and SYSTEM_ADMIN are all excluded.
       */
      shadowScore: router({
        report: requireRoles("AUDIT")
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            this.shadowScoreService.report(ctx.user, input.periodStart, input.periodEnd),
          ),

        /** Figures without names: does the model separate people sensibly? */
        anonymised: requireRoles("AUDIT")
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .query(({ ctx, input }) =>
            this.shadowScoreService.anonymisedScores(ctx.user, input.periodStart, input.periodEnd),
          ),

        compute: requireRoles("AUDIT")
          .input(z.object({ periodStart: z.date(), periodEnd: z.date() }))
          .mutation(({ input }) =>
            this.shadowScoreService.computePeriod(input.periodStart, input.periodEnd),
          ),
      }),

      /**
       * Who can reach what. Read by administrators and by Audit - a sensitive
       * role nobody can enumerate is a sensitive role nobody is reviewing.
       */
      access: router({
        /** Which workPulse roles currently have no route to a holder. */
        coverage: requireRoles("SYSTEM_ADMIN", "AUDIT").query(() =>
          this.roleGrantService.coverage(),
        ),

        /** Mappings alongside the Synapse roles that actually exist. */
        mappings: protectedProcedure.query(({ ctx }) => this.roleMapService.list(ctx.user)),

        upsertMapping: protectedProcedure
          .input(
            z.object({
              synapseRoleCode: z.string().min(2).max(60),
              workPulseRole: z.nativeEnum(WorkPulseRole),
              reason: z.string().max(500).optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.roleMapService.upsert(ctx.user, input)),

        deactivateMapping: protectedProcedure
          .input(z.object({ synapseRoleCode: z.string(), reason: z.string().min(1).max(500) }))
          .mutation(({ ctx, input }) =>
            this.roleMapService.deactivate(ctx.user, input.synapseRoleCode, input.reason),
          ),

        /** Everyone holding a directly granted role, with the grant trail. */
        holders: protectedProcedure.query(({ ctx }) => this.roleGrantService.holders(ctx.user)),

        grant: protectedProcedure
          .input(
            z.object({
              synapseUserUid: z.number().int().positive(),
              role: z.nativeEnum(WorkPulseRole),
              reason: z.string().max(500).optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.roleGrantService.grant(ctx.user, input)),

        revoke: protectedProcedure
          .input(
            z.object({
              synapseUserUid: z.number().int().positive(),
              role: z.nativeEnum(WorkPulseRole),
              reason: z.string().max(500).optional(),
            }),
          )
          .mutation(({ ctx, input }) => this.roleGrantService.revoke(ctx.user, input)),
      }),

    });
  }
}

/** Consumed by apps/web as a type-only import. Never imported at runtime. */
export type AppRouter = TrpcService["appRouter"];
