-- CreateEnum
CREATE TYPE "TaskFlagType" AS ENUM ('CLOSED_WITHOUT_EVIDENCE', 'REASSIGNMENT_PATTERN', 'ABNORMAL_TASK_SPLITTING', 'PRIORITY_INFLATION');

-- CreateEnum
CREATE TYPE "TaskFlagStatus" AS ENUM ('OPEN', 'REVIEWED_ACCEPTED', 'REVIEWED_DISMISSED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "isConfidential" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "task_flags" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "subjectEmployeeId" TEXT,
    "flagType" "TaskFlagType" NOT NULL,
    "status" "TaskFlagStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_periods" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "wtuDue" DOUBLE PRECISION NOT NULL,
    "wtuClosed" DOUBLE PRECISION NOT NULL,
    "wtuOnTime" DOUBLE PRECISION NOT NULL,
    "wtuReopened" DOUBLE PRECISION NOT NULL,
    "wtuFlagged" DOUBLE PRECISION NOT NULL,
    "execution" DOUBLE PRECISION,
    "timeliness" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "governance" DOUBLE PRECISION,
    "contribution" DOUBLE PRECISION,
    "hasSufficientVolume" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_flags_status_flagType_idx" ON "task_flags"("status", "flagType");

-- CreateIndex
CREATE INDEX "task_flags_subjectEmployeeId_idx" ON "task_flags"("subjectEmployeeId");

-- CreateIndex
CREATE INDEX "task_flags_taskId_idx" ON "task_flags"("taskId");

-- CreateIndex
CREATE INDEX "analytics_periods_periodStart_periodEnd_idx" ON "analytics_periods"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_periods_employeeId_periodStart_periodEnd_key" ON "analytics_periods"("employeeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "tasks_isConfidential_idx" ON "tasks"("isConfidential");

-- AddForeignKey
ALTER TABLE "task_flags" ADD CONSTRAINT "task_flags_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_flags" ADD CONSTRAINT "task_flags_subjectEmployeeId_fkey" FOREIGN KEY ("subjectEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_periods" ADD CONSTRAINT "analytics_periods_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

