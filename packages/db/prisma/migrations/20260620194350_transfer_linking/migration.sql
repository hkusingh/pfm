-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "awaitingCounterpartAccountId" TEXT;

-- CreateTable
CREATE TABLE "TransferPair" (
    "id" TEXT NOT NULL,
    "debitTxId" TEXT NOT NULL,
    "creditTxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferRoute" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "merchantMatch" TEXT NOT NULL,
    "counterpartAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferPair_debitTxId_key" ON "TransferPair"("debitTxId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferPair_creditTxId_key" ON "TransferPair"("creditTxId");

-- CreateIndex
CREATE INDEX "TransferRoute_householdId_idx" ON "TransferRoute"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRoute_sourceAccountId_merchantMatch_key" ON "TransferRoute"("sourceAccountId", "merchantMatch");

-- CreateIndex
CREATE INDEX "Transaction_awaitingCounterpartAccountId_idx" ON "Transaction"("awaitingCounterpartAccountId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_awaitingCounterpartAccountId_fkey" FOREIGN KEY ("awaitingCounterpartAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferPair" ADD CONSTRAINT "TransferPair_debitTxId_fkey" FOREIGN KEY ("debitTxId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferPair" ADD CONSTRAINT "TransferPair_creditTxId_fkey" FOREIGN KEY ("creditTxId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRoute" ADD CONSTRAINT "TransferRoute_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRoute" ADD CONSTRAINT "TransferRoute_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRoute" ADD CONSTRAINT "TransferRoute_counterpartAccountId_fkey" FOREIGN KEY ("counterpartAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
