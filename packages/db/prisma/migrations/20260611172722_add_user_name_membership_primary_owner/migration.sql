-- AlterTable: add name to User with a temporary default for existing rows, then drop the default
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ALTER COLUMN "name" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "isPrimaryOwner" BOOLEAN NOT NULL DEFAULT false;
