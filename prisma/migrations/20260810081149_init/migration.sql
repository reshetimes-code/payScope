-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE_CLOUD', 'OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ConnectionAuthType" AS ENUM ('WORKLOAD_IDENTITY', 'SERVICE_ACCOUNT_KEY', 'ADMIN_API_KEY');

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('FULL', 'PERCENTAGE', 'LABELS', 'CUSTOM_RULE');

-- CreateEnum
CREATE TYPE "AllocationConfidence" AS ENUM ('EXACT', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "BudgetScopeType" AS ENUM ('PROVIDER_ACCOUNT', 'PROVIDER_RESOURCE', 'MANAGED_APP');

-- CreateEnum
CREATE TYPE "EnforcementType" AS ENUM ('INTERNAL_ALERT', 'PROVIDER_ALERT', 'PROVIDER_HARD_LIMIT', 'EMERGENCY_SHUTDOWN');

-- CreateEnum
CREATE TYPE "StopActionCapability" AS ENUM ('PROVIDER_NATIVE_HARD_LIMIT', 'AUTOMATED_SERVICE_SHUTDOWN', 'BILLING_DISCONNECT', 'API_KEY_DISABLE_OR_ROTATION', 'MANUAL_ACTION_REQUIRED', 'MONITORING_ONLY');

-- CreateEnum
CREATE TYPE "ThresholdActionType" AS ENUM ('NOTIFY_ONLY', 'ESCALATE', 'TRIGGER_HARD_STOP');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "BudgetEventType" AS ENUM ('BUDGET_WARNING', 'BUDGET_CRITICAL', 'HARD_LIMIT_REACHED', 'HARD_STOP_STARTED', 'HARD_STOP_SUCCEEDED', 'HARD_STOP_FAILED', 'BUDGET_INCREASED', 'MANUAL_RESUME', 'AUTO_RESUME_NEW_CYCLE');

-- CreateEnum
CREATE TYPE "BudgetEventActor" AS ENUM ('SYSTEM', 'USER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "authType" "ConnectionAuthType" NOT NULL,
    "encryptedSecretReference" TEXT,
    "metadataJson" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_accounts" (
    "id" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "currency" TEXT,
    "metadataJson" JSONB,

    CONSTRAINT "provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_resources" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "externalResourceId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parentExternalId" TEXT,
    "metadataJson" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "managed_apps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerLabel" TEXT,
    "notes" TEXT,
    "monthlyTargetCurrency" TEXT NOT NULL DEFAULT 'USD',

    CONSTRAINT "managed_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_resource_mappings" (
    "id" TEXT NOT NULL,
    "managedAppId" TEXT NOT NULL,
    "providerResourceId" TEXT NOT NULL,
    "allocationMode" "AllocationMode" NOT NULL DEFAULT 'FULL',
    "allocationPercent" DECIMAL(5,2),
    "ruleJson" JSONB,
    "confidence" "AllocationConfidence" NOT NULL DEFAULT 'EXACT',

    CONSTRAINT "app_resource_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_records" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerResourceId" TEXT NOT NULL,
    "managedAppId" TEXT,
    "usageDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "grossCost" DECIMAL(14,4) NOT NULL,
    "credits" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "netCost" DECIMAL(14,4) NOT NULL,
    "service" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sourceReference" TEXT,
    "rawHash" TEXT NOT NULL,
    "metadataJson" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "scopeType" "BudgetScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "managedAppId" TEXT,
    "provider" "Provider" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'monthly',
    "enforcementType" "EnforcementType" NOT NULL DEFAULT 'INTERNAL_ALERT',
    "providerBudgetId" TEXT,
    "warningLimitPercent" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "hardLimitPercent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "hardStopEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoResumeNextBillingCycle" BOOLEAN NOT NULL DEFAULT false,
    "manualResumeRequiresBudgetIncrease" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_thresholds" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "notifyEmail" TEXT,
    "actionType" "ThresholdActionType" NOT NULL DEFAULT 'NOTIFY_ONLY',
    "triggeredAt" TIMESTAMP(3),
    "triggerCycleKey" TEXT,

    CONSTRAINT "budget_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_events" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "eventType" "BudgetEventType" NOT NULL,
    "actor" "BudgetEventActor" NOT NULL,
    "userId" TEXT,
    "spendAtEvent" DECIMAL(14,2),
    "percentConsumed" DECIMAL(5,2),
    "stopActionRequested" TEXT,
    "stopActionResult" TEXT,
    "providerResponse" JSONB,
    "preActionStateJson" JSONB,
    "previousBudgetAmount" DECIMAL(14,2),
    "newBudgetAmount" DECIMAL(14,2),
    "resumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "managedAppId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'monthly',
    "nextRenewalDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "type" TEXT NOT NULL,
    "provider" "Provider",
    "scopeType" "BudgetScopeType",
    "scopeId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncJobStatus" NOT NULL DEFAULT 'RUNNING',
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "provider" "Provider",
    "resource" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "result" "AuditResult" NOT NULL,
    "errorSummary" TEXT,
    "requestCorrelationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "provider_accounts_providerConnectionId_externalAccountId_key" ON "provider_accounts"("providerConnectionId", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_resources_providerAccountId_externalResourceId_key" ON "provider_resources"("providerAccountId", "externalResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "managed_apps_slug_key" ON "managed_apps"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "app_resource_mappings_managedAppId_providerResourceId_key" ON "app_resource_mappings"("managedAppId", "providerResourceId");

-- CreateIndex
CREATE INDEX "cost_records_providerResourceId_usageDate_idx" ON "cost_records"("providerResourceId", "usageDate");

-- CreateIndex
CREATE INDEX "cost_records_managedAppId_usageDate_idx" ON "cost_records"("managedAppId", "usageDate");

-- CreateIndex
CREATE UNIQUE INDEX "cost_records_providerResourceId_usageDate_service_sku_curre_key" ON "cost_records"("providerResourceId", "usageDate", "service", "sku", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "budget_thresholds_budgetId_percent_triggerCycleKey_key" ON "budget_thresholds"("budgetId", "percent", "triggerCycleKey");

-- CreateIndex
CREATE INDEX "budget_events_budgetId_createdAt_idx" ON "budget_events"("budgetId", "createdAt");

-- CreateIndex
CREATE INDEX "alerts_status_severity_idx" ON "alerts"("status", "severity");

-- CreateIndex
CREATE INDEX "sync_jobs_providerConnectionId_startedAt_idx" ON "sync_jobs"("providerConnectionId", "startedAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_resources" ADD CONSTRAINT "provider_resources_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "provider_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource_mappings" ADD CONSTRAINT "app_resource_mappings_managedAppId_fkey" FOREIGN KEY ("managedAppId") REFERENCES "managed_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource_mappings" ADD CONSTRAINT "app_resource_mappings_providerResourceId_fkey" FOREIGN KEY ("providerResourceId") REFERENCES "provider_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_providerResourceId_fkey" FOREIGN KEY ("providerResourceId") REFERENCES "provider_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_managedAppId_fkey" FOREIGN KEY ("managedAppId") REFERENCES "managed_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_managedAppId_fkey" FOREIGN KEY ("managedAppId") REFERENCES "managed_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_thresholds" ADD CONSTRAINT "budget_thresholds_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_managedAppId_fkey" FOREIGN KEY ("managedAppId") REFERENCES "managed_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
