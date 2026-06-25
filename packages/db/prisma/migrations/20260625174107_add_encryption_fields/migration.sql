-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "balanceMinor" DROP DEFAULT,
ALTER COLUMN "balanceMinor" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "merchantRuleHash" TEXT,
ALTER COLUMN "amountMinor" SET DATA TYPE TEXT;
