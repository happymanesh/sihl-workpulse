-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "designationId" TEXT;

-- CreateTable
CREATE TABLE "designations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalised" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalised" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "designations_normalised_key" ON "designations"("normalised");

-- CreateIndex
CREATE UNIQUE INDEX "branches_normalised_key" ON "branches"("normalised");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
