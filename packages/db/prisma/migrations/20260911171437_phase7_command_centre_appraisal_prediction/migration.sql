-- CreateEnum
CREATE TYPE "Complexity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CommandCentreEventType" AS ENUM ('SLA_BREACH', 'ESCALATION_TOP_LEVEL', 'CRITICAL_OVERDUE', 'RECURRING_COMPLIANCE_MISSED', 'BLOCKED_BEYOND_THRESHOLD', 'PROJECT_HEALTH_DEGRADED');

-- CreateEnum
CREATE TYPE "CommandCentreSeverity" AS ENUM ('INFO', 'ATTENTION', 'URGENT');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "complexity" "Complexity";

-- CreateTable
CREATE TABLE "command_centre_events" (
    "id" TEXT NOT NULL,
    "eventType" "CommandCentreEventType" NOT NULL,
    "severity" "CommandCentreSeverity" NOT NULL DEFAULT 'ATTENTION',
    "headline" TEXT NOT NULL,
    "detail" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "departmentId" TEXT,
    "employeeId" TEXT,
    "sequence" BIGSERIAL NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_centre_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_evidence" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cycleLabel" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "execution" DOUBLE PRECISION,
    "timeliness" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "governance" DOUBLE PRECISION,
    "contribution" DOUBLE PRECISION,
    "hasSufficientVolume" BOOLEAN NOT NULL DEFAULT false,
    "wtuDue" DOUBLE PRECISION NOT NULL,
    "wtuClosed" DOUBLE PRECISION NOT NULL,
    "wtuOnTime" DOUBLE PRECISION NOT NULL,
    "wtuReopened" DOUBLE PRECISION NOT NULL,
    "openFlagCount" INTEGER NOT NULL DEFAULT 0,
    "excludedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disclosedToSubjectAt" TIMESTAMP(3),

    CONSTRAINT "appraisal_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shadow_scores" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "weightsJson" JSONB NOT NULL,
    "composite" DOUBLE PRECISION NOT NULL,
    "isInForce" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shadow_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_predictions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "risk" DOUBLE PRECISION NOT NULL,
    "factorsJson" JSONB NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actuallyBreached" BOOLEAN,
    "outcomeAt" TIMESTAMP(3),

    CONSTRAINT "sla_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "command_centre_events_sequence_key" ON "command_centre_events"("sequence");

-- CreateIndex
CREATE INDEX "command_centre_events_sequence_idx" ON "command_centre_events"("sequence");

-- CreateIndex
CREATE INDEX "command_centre_events_eventType_resolvedAt_idx" ON "command_centre_events"("eventType", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "command_centre_events_dedupeKey_resolvedAt_key" ON "command_centre_events"("dedupeKey", "resolvedAt");

-- CreateIndex
CREATE INDEX "appraisal_evidence_cycleLabel_idx" ON "appraisal_evidence"("cycleLabel");

-- CreateIndex
CREATE UNIQUE INDEX "appraisal_evidence_employeeId_cycleLabel_key" ON "appraisal_evidence"("employeeId", "cycleLabel");

-- CreateIndex
CREATE INDEX "shadow_scores_periodStart_periodEnd_idx" ON "shadow_scores"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "shadow_scores_employeeId_periodStart_periodEnd_key" ON "shadow_scores"("employeeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "sla_predictions_taskId_predictedAt_idx" ON "sla_predictions"("taskId", "predictedAt");

-- CreateIndex
CREATE INDEX "sla_predictions_actuallyBreached_idx" ON "sla_predictions"("actuallyBreached");

-- AddForeignKey
ALTER TABLE "command_centre_events" ADD CONSTRAINT "command_centre_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_centre_events" ADD CONSTRAINT "command_centre_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_centre_events" ADD CONSTRAINT "command_centre_events_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_centre_events" ADD CONSTRAINT "command_centre_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_evidence" ADD CONSTRAINT "appraisal_evidence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shadow_scores" ADD CONSTRAINT "shadow_scores_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_predictions" ADD CONSTRAINT "sla_predictions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
