-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "phoneDigits" TEXT;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "phoneDigits" TEXT;

-- Busca rápida por trechos de nome e telefone (busca global)
CREATE INDEX IF NOT EXISTS patients_name_trgm ON "patients" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS patients_phone_trgm ON "patients" USING gin ("phoneDigits" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_name_trgm ON "leads" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_phone_trgm ON "leads" USING gin ("phoneDigits" gin_trgm_ops);
