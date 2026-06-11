-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('admin_invite', 'beta_invite', 'open');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSiteAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RegistrationPolicy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" "RegistrationMode" NOT NULL DEFAULT 'admin_invite',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "RegistrationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "issuedByAdminId" TEXT NOT NULL,
    "issuedByHouseholdId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignupInvite_token_key" ON "SignupInvite"("token");

-- CreateIndex
CREATE INDEX "SignupInvite_email_idx" ON "SignupInvite"("email");

-- CreateIndex
CREATE INDEX "SignupInvite_token_idx" ON "SignupInvite"("token");

-- AddForeignKey
ALTER TABLE "SignupInvite" ADD CONSTRAINT "SignupInvite_issuedByAdminId_fkey" FOREIGN KEY ("issuedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
