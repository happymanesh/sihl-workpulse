-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hiddenNavKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
