-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'URGENT', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "TaskOrigin" AS ENUM ('DESK_CARD', 'ADHOC', 'PROJECT', 'SOURCE_SYSTEM', 'MEETING', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'PENDING_REVIEW', 'COMPLETED', 'VERIFIED', 'CLOSED', 'REJECTED', 'REOPENED', 'CANCELLED', 'ON_HOLD', 'DEFERRED');

-- CreateTable
CREATE TABLE "task_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "requiresMakerChecker" BOOLEAN NOT NULL DEFAULT false,
    "autoCloseAfterHours" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_cards" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "holderEmployeeId" TEXT,
    "holderSince" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_card_holder_history" (
    "id" TEXT NOT NULL,
    "deskCardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3),
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desk_card_holder_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk_card_activities" (
    "id" TEXT NOT NULL,
    "deskCardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskTypeId" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "estimatedMinutes" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "RecurrenceFrequency",
    "interval" INTEGER NOT NULL DEFAULT 1,
    "daysOfWeek" INTEGER[],
    "dayOfMonth" INTEGER,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "lastGeneratedFor" TIMESTAMP(3),
    "processId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_card_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "origin" "TaskOrigin" NOT NULL DEFAULT 'ADHOC',
    "taskTypeId" TEXT NOT NULL,
    "deskCardActivityId" TEXT,
    "assigneeEmployeeId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT,
    "departmentId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "estimatedMinutes" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "blockingOwnerEmployeeId" TEXT,
    "isMissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_status_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus" NOT NULL,
    "actorUserId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_types_code_key" ON "task_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "desk_cards_code_key" ON "desk_cards"("code");

-- CreateIndex
CREATE INDEX "desk_cards_departmentId_idx" ON "desk_cards"("departmentId");

-- CreateIndex
CREATE INDEX "desk_cards_holderEmployeeId_idx" ON "desk_cards"("holderEmployeeId");

-- CreateIndex
CREATE INDEX "desk_card_holder_history_deskCardId_idx" ON "desk_card_holder_history"("deskCardId");

-- CreateIndex
CREATE INDEX "desk_card_holder_history_employeeId_idx" ON "desk_card_holder_history"("employeeId");

-- CreateIndex
CREATE INDEX "desk_card_activities_deskCardId_idx" ON "desk_card_activities"("deskCardId");

-- CreateIndex
CREATE INDEX "desk_card_activities_taskTypeId_idx" ON "desk_card_activities"("taskTypeId");

-- CreateIndex
CREATE INDEX "desk_card_activities_isActive_isPaused_idx" ON "desk_card_activities"("isActive", "isPaused");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_reference_key" ON "tasks"("reference");

-- CreateIndex
CREATE INDEX "tasks_assigneeEmployeeId_status_idx" ON "tasks"("assigneeEmployeeId", "status");

-- CreateIndex
CREATE INDEX "tasks_deskCardActivityId_idx" ON "tasks"("deskCardActivityId");

-- CreateIndex
CREATE INDEX "tasks_status_dueDate_idx" ON "tasks"("status", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_departmentId_idx" ON "tasks"("departmentId");

-- CreateIndex
CREATE INDEX "task_checklist_items_taskId_idx" ON "task_checklist_items"("taskId");

-- CreateIndex
CREATE INDEX "task_status_history_taskId_createdAt_idx" ON "task_status_history"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "desk_cards" ADD CONSTRAINT "desk_cards_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_cards" ADD CONSTRAINT "desk_cards_holderEmployeeId_fkey" FOREIGN KEY ("holderEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_card_holder_history" ADD CONSTRAINT "desk_card_holder_history_deskCardId_fkey" FOREIGN KEY ("deskCardId") REFERENCES "desk_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_card_holder_history" ADD CONSTRAINT "desk_card_holder_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_card_activities" ADD CONSTRAINT "desk_card_activities_deskCardId_fkey" FOREIGN KEY ("deskCardId") REFERENCES "desk_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk_card_activities" ADD CONSTRAINT "desk_card_activities_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deskCardActivityId_fkey" FOREIGN KEY ("deskCardActivityId") REFERENCES "desk_card_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeEmployeeId_fkey" FOREIGN KEY ("assigneeEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerEmployeeId_fkey" FOREIGN KEY ("reviewerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

