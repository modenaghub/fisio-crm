# FisioCRM — Arquitetura do Sistema

Documento de referência para o desenvolvimento do SaaS de gestão para fisioterapeutas e clínicas de fisioterapia.
Ele cobre a etapa "antes de codificar" pedida na especificação (seção 41): arquitetura, banco, entidades, fluxos, permissões, telas e dependências externas.

---

## 1. Visão geral

```
┌──────────────────────┐        HTTPS/JSON         ┌───────────────────────────┐
│  Web (React + TS)    │ ────────────────────────► │  API (NestJS + TS)        │
│  Vite · Tailwind     │ ◄──────────────────────── │  REST /api/v1             │
│  TanStack Query      │   access token (memória)  │  Guards: JWT · RBAC ·     │
│  React Router        │   refresh (cookie httpOnly)│  Tenant · Throttle        │
└──────────────────────┘                           └────────────┬──────────────┘
                                                                │ Prisma
                                   ┌────────────────────────────┼─────────────────────────┐
                                   ▼                            ▼                         ▼
                           ┌───────────────┐          ┌──────────────────┐      ┌──────────────────┐
                           │ PostgreSQL 16 │          │ Fila de jobs     │      │ Storage de       │
                           │ (dados + audit│          │ (Fase 7/8: Redis │      │ documentos (S3   │
                           │  imutável)    │          │  + BullMQ)       │      │  compatível)     │
                           └───────────────┘          └────────┬─────────┘      └──────────────────┘
                                                               │
                         Adaptadores de integração (interface + implementação mock/real)
                 WhatsApp Cloud API · E-mail (SMTP/SES) · Google Calendar · Gateway de pagamento · IA
```

**Por que esta stack**

| Camada | Escolha | Motivo |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind 4 | Pedido na especificação; build rápido; tipagem ponta a ponta |
| Estado remoto | TanStack Query | Cache, loading/erro padronizados em todas as telas |
| Formulários | react-hook-form + zod | Validação declarativa, mesmas regras que a API |
| Backend | NestJS 11 | Módulos, injeção de dependência, guards e interceptors — adequado a um SaaS com muitas regras de negócio |
| ORM | Prisma 6 | Schema único e legível, migrações versionadas, tipos gerados |
| Banco | PostgreSQL 16 | Relacional, transações, JSONB para avaliações/escalas, triggers para auditoria imutável |
| Hash de senha | Argon2id | Recomendação atual da OWASP |
| Jobs (Fase 7+) | BullMQ + Redis | Lembretes agendados, envio de mensagens, automações |

## 2. Multiempresa, multiunidade e isolamento

- **Organization** = o cliente do SaaS (um fisioterapeuta autônomo ou uma rede de clínicas). É o *tenant*.
- **Unit** = unidade/filial de uma organização. Toda organização nasce com uma unidade.
- Toda tabela de negócio tem `organizationId`. Tabelas operacionais (agenda, atendimentos, financeiro) também têm `unitId`.
- O `organizationId` **nunca vem do cliente**: é extraído do token JWT pelo `TenantGuard` e injetado nos serviços. Todas as consultas filtram por ele.
- Um teste ponta a ponta verifica que um usuário de uma organização não consegue ler dados de outra.
- Evolução prevista: habilitar Row Level Security do PostgreSQL como segunda barreira (`SET app.organization_id` por transação).

## 3. Autenticação e sessão

| Item | Implementação |
|---|---|
| Cadastro | `POST /auth/register` cria organização, unidade padrão, papéis padrão e o usuário administrador |
| Senha | Argon2id; mínimo 8 caracteres com letra e número |
| Access token | JWT, 15 min, guardado só em memória no navegador |
| Refresh token | Opaco, 30 dias, cookie `httpOnly` + `SameSite=Strict`, armazenado com hash na tabela `sessions` |
| Rotação | Cada refresh gera novo token; reutilização de um token antigo revoga toda a família de sessões (detecção de roubo) |
| Bloqueio | 5 tentativas erradas → conta bloqueada por 15 min; rate limit por IP no login |
| Recuperação | Token de uso único, 1 h, armazenado com hash; resposta idêntica exista ou não o e-mail |
| Sessões | Usuário vê e encerra suas sessões ativas; troca de senha encerra as demais |
| Desativação | Usuário desativado perde todas as sessões imediatamente |

## 4. Perfis e permissões (RBAC)

Permissões são códigos finos (`recurso.ação`). Papéis agrupam permissões. Cada usuário tem **um papel** e pode receber **exceções individuais** (conceder ou negar), que é como a recepção pode ganhar acesso clínico "caso essa permissão seja concedida".

| Permissão | Administrador | Fisioterapeuta | Recepção |
|---|:-:|:-:|:-:|
| `dashboard.view` | ✔ | ✔ | ✔ |
| `users.manage` | ✔ | | |
| `settings.manage` | ✔ | | |
| `audit.view` | ✔ | | |
| `leads.read` / `leads.write` | ✔ | ✔ | ✔ |
| `patients.read` / `patients.write` | ✔ | ✔ (próprios) | ✔ |
| `patients.read_all` | ✔ | | ✔ |
| `clinical.read` / `clinical.write` | ✔ | ✔ | ✘ (concedível) |
| `clinical.delete` | ✔ | | |
| `schedule.read` / `schedule.write` | ✔ | ✔ | ✔ |
| `finance.read` / `finance.write` | ✔ | | ✔ (pagamentos) |
| `finance.reports` | ✔ | | |
| `messages.read` / `messages.send` | ✔ | ✔ | ✔ |
| `automations.manage` | ✔ | | |
| `reports.view` | ✔ | ✔ | |
| `documents.read` / `documents.write` | ✔ | ✔ | ✔ (não clínicos) |
| `tasks.manage` | ✔ | ✔ | ✔ |

A tabela `permissions` é o catálogo; `role_permissions` define os papéis; `user_permission_overrides` guarda exceções. O cálculo final (`efetivas = papel + concedidas − negadas`) é feito no login e verificado pelo `PermissionsGuard` em cada rota. Papéis do sistema não podem ser apagados; a organização pode criar papéis próprios.

**"Fisioterapeuta vê seus pacientes"**: um paciente pertence a um profissional responsável (`responsibleUserId`) e a quem já o atendeu. Sem `patients.read_all`, a API filtra por esse vínculo.

## 5. Auditoria e prontuário imutável

- `audit_logs` registra: quem, organização, ação (`CREATE`, `UPDATE`, `DELETE`, `READ`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_RESET`, `PERMISSION_CHANGE`, `EXPORT`…), entidade, id, diferenças antes/depois, IP, user-agent e data/hora.
- A tabela é **somente inserção**: um trigger no PostgreSQL rejeita `UPDATE` e `DELETE`.
- Leitura de dados clínicos gera log `READ` (quem acessou o prontuário).
- Campos sensíveis (senha, tokens, CPF em claro) nunca entram no log.
- **Evoluções clínicas**: editar cria uma nova versão em `session_evolution_versions`; o texto original permanece. Exclusão é lógica (`deletedAt`) e só com `clinical.delete` (administrador), com motivo obrigatório. Um trigger também impede apagar versões.

## 6. LGPD e segurança

| Requisito | Como é atendido |
|---|---|
| Base legal / consentimento | Tabela `consents` (finalidade, versão do termo, canal, data de aceite e revogação) |
| Minimização | Recepção não vê dados clínicos sem permissão; API remove os campos na resposta |
| Criptografia | TLS em trânsito; CPF cifrado com AES-256-GCM + hash HMAC para busca exata; segredos de integrações cifrados; disco do banco cifrado na hospedagem |
| Logs de acesso | `audit_logs` com `READ` para prontuário |
| Direitos do titular | Exportação dos dados do paciente (JSON/PDF) e anonimização quando cabível — Fase 10 |
| Retenção | Prazo configurável por organização. Prontuário tem guarda mínima definida por normas profissionais: validar o prazo com o jurídico e as resoluções do COFFITO antes de ativar qualquer expurgo |
| Backup | `pg_dump` diário cifrado + retenção; restauração testada — documentado no README de implantação |
| Cabeçalhos | Helmet, CORS restrito à origem do frontend, cookies `Secure` em produção |

## 7. Modelo de dados

O schema completo está em `api/prisma/schema.prisma`. Resumo por domínio:

**Plataforma**: `organizations`, `units`, `users`, `user_units`, `roles`, `permissions`, `role_permissions`, `user_permission_overrides`, `sessions`, `password_reset_tokens`, `audit_logs`, `business_settings`, `integration_configs`, `consents`

**Cadastros e agenda**: `services` (avaliação, sessão, pilates…), `professional_profiles` (CREFITO, especialidades, cor na agenda), `availability_rules` (dia da semana + faixa), `availability_exceptions` (folga, feriado, férias, bloqueio, horário extra), `holidays`, `appointments`, `appointment_status_history`, `recurrence_series`

**CRM**: `leads` (etapas 1–5 do funil, origem, classificação, respostas do bot), `patients` (etapas 6–11: tratamento iniciado → reativação)

**Clínico**: `medical_conditions` (catálogo, CID-10 opcional), `patient_conditions`, `clinical_profiles` (queixa, histórico, medicamentos, alergias, contraindicações), `evaluations` (dor, ADM, força, testes e escalas em JSONB), `treatment_plans`, `treatment_sessions`, `session_evolutions`, `session_evolution_versions`

**Financeiro**: `package_templates`, `packages` (pacote vendido ao paciente), `package_sessions` (consumo), `payments` (contas a receber), `expenses`, `expense_categories`, `financial_transactions` (livro-caixa)

**Comunicação e automação**: `conversations`, `messages`, `message_templates`, `automations`, `automation_runs`, `notifications`, `tasks`, `documents`, `goals`

Convenções: IDs `uuid`; valores em **centavos** (`Int`) para evitar erro de arredondamento; datas `timestamptz`; fuso da organização (padrão `America/Sao_Paulo`); `createdAt/updatedAt/createdById/updatedById` nas tabelas de negócio; exclusão lógica (`deletedAt`) onde há valor histórico.

### Por que `leads` e `patients` separados

O lead é uma oportunidade (pode nunca virar paciente, pode não ter CPF). Ao converter, cria-se o paciente e o lead guarda `patientId`. O Kanban junta os dois: etapas 1–5 vêm de `leads.stage`; etapas 6–11 vêm de `patients.crmStage`. Um paciente antigo que volta gera um novo ciclo na etapa "Reativação" sem perder o histórico.

## 8. Fluxos principais

**Primeiro contato (Fase 7)**
WhatsApp → webhook `/integrations/whatsapp/webhook` (assinatura verificada) → número desconhecido → cria `conversation` com `botState` → bot pergunta os 10 itens um a um, validando CPF e data → cria `lead` (Novo contato → Dados coletados), salva a conversa, classifica, notifica o fisioterapeuta, cria tarefa "Agendar avaliação".

**Atendimento (Fases 4–6)**
Agendamento realizado → fisioterapeuta abre o atendimento → registra evolução → transação única: `treatment_session` criada, número da sessão calculado, `package_sessions` desconta 1 do pacote, `payments` gerado/atualizado, evento na linha do tempo, status do agendamento = Realizado → automação "pós-atendimento".

**Recorrência (Fase 5)**
"2× por semana por 3 meses, terças e quintas 15h" → `recurrence_series` → geração dos `appointments` validando disponibilidade e conflitos → conflitos listados para o usuário decidir.

**Projeção de faturamento (Fase 6)**
Receita prevista = Σ agendamentos futuros não cancelados × valor (do serviço ou do pacote) + parcelas a vencer de pacotes − o que já foi pago. Receita perdida = cancelamentos + faltas no período. Janelas: hoje, semana, mês, próximo mês, 3, 6 e 12 meses.

## 9. Integrações externas (adaptadores)

Cada integração é uma interface com implementação **mock** (padrão em desenvolvimento, registra em log e na tabela correspondente) e implementação real ativada por variável de ambiente. Os pontos de conexão estão marcados no código com `// INTEGRAÇÃO REAL:`.

| Integração | Interface | Mock atual | Real (a conectar) |
|---|---|---|---|
| E-mail | `EmailProvider` | Loga o e-mail e grava em `messages` | SMTP / Amazon SES / Resend |
| WhatsApp | `WhatsAppProvider` | Simulador interno de conversa | WhatsApp Business Platform (Cloud API oficial) — templates aprovados para mensagens fora da janela de 24 h |
| Calendário | `CalendarProvider` | Nenhuma sincronização | Google Calendar API (OAuth por profissional) |
| Pagamentos | `PaymentGateway` | Marca como pago manualmente | Gateway com PIX e cartão (ex.: Asaas, Mercado Pago, Stripe) |
| IA | `AiProvider` | Respostas fixas identificadas como demonstração | Claude API — apenas resumos e organização; nunca diagnóstico |

Dependências que você precisará providenciar: conta Meta Business verificada + número dedicado para WhatsApp; domínio e provedor de e-mail transacional; projeto no Google Cloud para Calendar; conta no gateway de pagamento; chave da API de IA; hospedagem com PostgreSQL gerenciado e backup.

## 10. Telas

Sidebar: Dashboard · CRM · Pacientes · Agenda · Atendimentos · Prontuários · Comunicação · Financeiro · Relatórios · Tarefas · Configurações. Os itens aparecem conforme as permissões do usuário.

Todas as telas usam os mesmos componentes de estado: carregando (skeleton), vazio (com ação sugerida), erro (com "tentar novamente"), confirmação para ações destrutivas e toasts de sucesso/erro.

## 11. Estrutura do repositório

```
fisio-crm/
├── docker-compose.yml        # postgres + api + web
├── docs/ARQUITETURA.md
├── api/
│   ├── prisma/schema.prisma  # todas as entidades
│   ├── prisma/migrations/    # SQL versionado + triggers de auditoria
│   ├── prisma/seed.ts        # catálogo de permissões + organização demo
│   └── src/
│       ├── common/           # prisma, crypto, guards, decorators, filtros
│       ├── modules/          # auth, users, roles, organization, onboarding, audit…
│       └── integrations/     # email, whatsapp, calendar, payments, ai (interfaces + mocks)
└── web/
    └── src/
        ├── lib/              # cliente HTTP, auth, permissões
        ├── components/       # UI base + estados
        ├── layouts/
        └── pages/
```

## 12. Plano de fases

| Fase | Entrega | Status |
|---|---|---|
| 1 | Arquitetura, schema completo, autenticação, perfis, permissões, auditoria, onboarding, usuários | **Entregue nesta rodada** |
| 2 | Dashboard e resumo executivo | Próxima |
| 3 | CRM Kanban, leads, pacientes, busca global | |
| 4 | Prontuário, avaliações, plano, evoluções, linha do tempo | |
| 5 | Agenda (dia/semana/mês, arrastar), disponibilidade, recorrência | |
| 6 | Financeiro, pacotes, projeções, metas | |
| 7 | Central de comunicação, WhatsApp, bot de primeiro contato, lembretes | |
| 8 | Motor de automações, tarefas, notificações | |
| 9 | Relatórios com filtros e exportação PDF/CSV | |
| 10 | LGPD: exportação/anonimização, retenção, backup, RLS | |
| 11 | IA assistiva | |
