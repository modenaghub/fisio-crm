-- Registros imutáveis: auditoria e versões de evolução clínica.
-- Qualquer UPDATE ou DELETE é rejeitado pelo próprio banco, mesmo que venha de fora da aplicação.
-- Exceção: exclusão em cascata ao apagar uma organização inteira (encerramento de conta / LGPD),
-- liberada apenas quando a sessão define SET LOCAL app.allow_purge = 'on'.

CREATE OR REPLACE FUNCTION fisio_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Registro imutável: % em % não é permitido', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION fisio_block_mutation();

CREATE TRIGGER session_evolution_versions_immutable
  BEFORE UPDATE OR DELETE ON "session_evolution_versions"
  FOR EACH ROW EXECUTE FUNCTION fisio_block_mutation();

-- Sequência de código de paciente por organização é gerada na aplicação dentro de transação;
-- este índice garante busca rápida por nome sem acento/caixa (busca global, Fase 3).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
