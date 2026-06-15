-- CreateTable
CREATE TABLE "SavedChart" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chartType" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "groupBy" TEXT NOT NULL,
    "dateRange" TEXT NOT NULL,
    "accountId" TEXT,
    "categoryId" TEXT,
    "view" TEXT NOT NULL DEFAULT 'household',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedChart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedChart_householdId_idx" ON "SavedChart"("householdId");

-- AddForeignKey
ALTER TABLE "SavedChart" ADD CONSTRAINT "SavedChart_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedChart" ADD CONSTRAINT "SavedChart_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
