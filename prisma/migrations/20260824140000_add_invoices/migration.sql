-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "billingAccountName" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfBytes" BYTEA NOT NULL,
    "pdfFilename" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_periodStart_idx" ON "invoices"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_billingAccountId_periodStart_key" ON "invoices"("billingAccountId", "periodStart");
