# FisioCRM

SaaS de gestão para fisioterapeutas e clínicas de fisioterapia: CRM, prontuário, agenda, WhatsApp e financeiro.

**Status: Fase 1 entregue** — arquitetura, banco de dados completo (todas as fases), autenticação, perfis e permissões, auditoria imutável, primeiro acesso (onboarding) e gestão da equipe. Os demais módulos aparecem no menu marcados com a fase em que serão entregues.

A arquitetura completa (entidades, fluxos, permissões, integrações e plano de fases) está em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

## Stack

| | |
|---|---|
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS 4 · TanStack Query · react-hook-form + zod |
| Backend | Node.js 22 · NestJS 11 · Prisma 6 |
| Banco | PostgreSQL 16 |
| Segurança | Argon2id · JWT curto + refresh rotativo em cookie httpOnly · AES-256-GCM · Helmet · rate limit |

## Rodar com Docker (recomendado)

```bash
cp .env.example .env
# preencha POSTGRES_PASSWORD, JWT_SECRET, DATA_ENCRYPTION_KEY e DATA_HASH_KEY (instruções no arquivo)
docker compose up -d --build
```

Acesse **http://localhost:8080** e clique em **Criar conta da clínica**. O assistente de primeiro acesso abre em seguida.

> Em produção, o sistema precisa estar atrás de **HTTPS** (o cookie de sessão é `Secure`). Em `localhost` os navegadores aceitam sem HTTPS.

## Rodar em desenvolvimento

Pré-requisitos: Node.js 22 e um PostgreSQL 16 acessível.

```bash
# API
cd api
cp .env.example .env              # ajuste DATABASE_URL; em dev os segredos têm valores padrão
npm install
npx prisma migrate deploy
npm run db:seed                   # opcional: clínica de demonstração
npm run dev                       # http://localhost:3000/api/v1

# Web (outro terminal)
cd web
npm install
npm run dev                       # http://localhost:5173 (encaminha /api para a porta 3000)
```

### Clínica de demonstração (somente desenvolvimento)

`npm run db:seed` cria a "Clínica Demonstração" com um usuário por perfil. Senha de todos: `Demo@2026`.

| E-mail | Perfil |
|---|---|
| admin@demo.fisiocrm.local | Administrador |
| fisio@demo.fisiocrm.local | Fisioterapeuta |
| recepcao@demo.fisiocrm.local | Recepção |

O seed se recusa a rodar com `NODE_ENV=production`.

### E-mails em modo demonstração

Sem provedor de e-mail configurado (`EMAIL_PROVIDER=mock`), nenhum e-mail é enviado. Em desenvolvimento, os convites e links de redefinição de senha aparecem em **http://localhost:5173/dev/emails**. Essa página e o endpoint correspondente ficam desativados em produção.

## Testes

Testes ponta a ponta contra a API rodando e um PostgreSQL real (14 cenários):

```bash
cd api
npm run build
AUTH_ROTATION_GRACE_MS=0 node dist/main.js &     # API de teste
npm run db:seed                                  # o teste de isolamento usa a clínica demo
npm run test:e2e
```

Cobrem: cadastro, onboarding com validação por etapa, criação de usuários (senha e convite), permissões por perfil, exceções individuais, proteção do papel Administrador, **isolamento entre clínicas**, desativação com corte imediato de acesso, **rotação de refresh token com detecção de reuso**, troca e redefinição de senha, bloqueio após 5 tentativas, **imutabilidade da auditoria no banco** e logout.

## O que a Fase 1 entrega

**Backend**
- Schema completo com 48 tabelas para todas as fases (pacientes, prontuário, agenda, financeiro, comunicação, automações, tarefas, documentos, metas, LGPD).
- Multiempresa e multiunidade: toda consulta é filtrada pela organização do token.
- Autenticação: cadastro de clínica, login (com escolha de clínica quando o e-mail existe em mais de uma), refresh rotativo, logout, sessões ativas, troca e recuperação de senha, convite de usuários, bloqueio por tentativas.
- RBAC com 30 permissões, 3 perfis padrão, perfis personalizados e exceções por usuário. Recepção **não** acessa prontuário, a menos que o administrador conceda.
- Auditoria de toda alteração, login e mudança de permissão. Um trigger no PostgreSQL impede `UPDATE`/`DELETE` em `audit_logs` e nas versões de evolução clínica.
- CPF cifrado (AES-256-GCM) com hash HMAC para busca.
- Adaptadores de integração (e-mail, WhatsApp Cloud API, Google Calendar, gateway de pagamento, IA) com implementação de demonstração; os pontos de conexão real estão marcados com `INTEGRAÇÃO REAL` no código.

**Frontend**
- Login, cadastro, esqueci a senha, nova senha / aceite de convite.
- Primeiro acesso em 9 etapas até "Seu sistema está pronto."
- Layout com menu por permissão, responsivo (gaveta no celular).
- Configurações: minha conta (perfil, senha, sessões ativas), clínica e regras de agendamento, horários, serviços e valores, unidades, usuários, perfis e permissões, auditoria com filtros.
- Estados de carregamento, vazio e erro, confirmação de ações destrutivas e mensagens de sucesso/erro em todas as telas.

## API — rotas da Fase 1 (`/api/v1`)

| Método | Rota | Permissão |
|---|---|---|
| POST | `/auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` | pública |
| POST | `/auth/forgot-password` · `/auth/reset-password` | pública |
| GET/PATCH | `/auth/me` | autenticado |
| POST | `/auth/change-password` | autenticado |
| GET/DELETE | `/auth/sessions` · `/auth/sessions/:id` · POST `/auth/sessions/revoke-others` | autenticado |
| GET/POST/PATCH | `/users` · `/users/:id` | `users.manage` |
| PUT | `/users/:id/active` · POST `/users/:id/unlock` · POST `/users/:id/send-access-link` | `users.manage` |
| PUT | `/users/:id/permissions` | `users.manage` + `roles.manage` |
| GET | `/users/professionals` | autenticado |
| GET | `/roles` · `/roles/permissions` | `users.manage` |
| POST/PATCH/DELETE | `/roles` · `/roles/:id` | `roles.manage` |
| GET/PATCH | `/settings` | `settings.manage` |
| GET/PUT | `/settings/hours` | leitura: autenticado · escrita: `schedule.availability` |
| GET/PUT | `/settings/services` | leitura: autenticado · escrita: `settings.manage` |
| GET/POST/PATCH | `/settings/units` | leitura: autenticado · escrita: `settings.manage` |
| GET/PUT/POST | `/onboarding` · `/onboarding/steps/:n` · `/onboarding/complete` | `settings.manage` |
| GET | `/audit-logs` · `/audit-logs/entities` | `audit.view` |
| GET | `/health` · `/system/info` | pública |

## Checklist de produção

- [ ] HTTPS obrigatório (proxy reverso ou balanceador com TLS).
- [ ] Segredos gerados com `openssl` e guardados em cofre; **backup da `DATA_ENCRYPTION_KEY`** — sem ela os CPFs não podem ser lidos.
- [ ] PostgreSQL gerenciado com disco cifrado, backup diário automático e teste de restauração.
- [ ] A API só deve ser acessível pelo proxy (o rate limit confia no `X-Forwarded-For` do primeiro proxy).
- [ ] Provedor de e-mail real configurado (`EMAIL_PROVIDER=smtp` + implementação em `api/src/integrations/email/smtp-email.provider.ts`).
- [ ] Termos de uso e política de privacidade revisados pelo jurídico; prazo de guarda de prontuário validado conforme normas do COFFITO antes de ativar qualquer expurgo.

## Limitações conhecidas desta fase

- O logo da clínica é guardado no banco como imagem embutida (até 300 KB). Na fase de documentos ele passa para storage S3.
- Folgas, feriados, férias e bloqueios têm tabelas prontas, mas a tela vem com a Agenda (Fase 5).
- A imagem Docker não foi construída neste ambiente de desenvolvimento; os mesmos passos (instalação limpa, migração em banco vazio, build e inicialização em modo produção) foram executados e verificados fora do Docker.

## Próxima etapa — Fase 2

Dashboard e resumo executivo ("Como está minha clínica hoje?"). Como o dashboard depende de agenda, pacientes e financeiro, a sugestão é desenvolver a Fase 2 junto com a Fase 3 (CRM e pacientes), para que os indicadores já nasçam com dados reais.
