-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_ownerUserId_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "ownerUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
