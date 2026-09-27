-- DropIndex
DROP INDEX "leads_name_trgm";

-- DropIndex
DROP INDEX "leads_phone_trgm";

-- DropIndex
DROP INDEX "patients_name_trgm";

-- DropIndex
DROP INDEX "patients_phone_trgm";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "message_dispatches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "conversationId" UUID,
    "messageId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_dispatches_conversationId_createdAt_idx" ON "message_dispatches"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_dispatches_organizationId_key_entityId_key" ON "message_dispatches"("organizationId", "key", "entityId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
