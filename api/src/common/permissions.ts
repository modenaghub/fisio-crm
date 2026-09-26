/**
 * Catálogo de permissões do sistema e papéis padrão.
 * Fonte única: usado pelo seed, pelo cadastro de novas organizações e pelos guards.
 */

export const PERMISSIONS = {
  // Plataforma
  DASHBOARD_VIEW: 'dashboard.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  INTEGRATIONS_MANAGE: 'integrations.manage',
  AUDIT_VIEW: 'audit.view',
  DATA_EXPORT: 'data.export',
  // CRM
  LEADS_READ: 'leads.read',
  LEADS_WRITE: 'leads.write',
  PATIENTS_READ: 'patients.read',
  PATIENTS_READ_ALL: 'patients.read_all',
  PATIENTS_WRITE: 'patients.write',
  PATIENTS_DELETE: 'patients.delete',
  // Clínico (dado sensível)
  CLINICAL_READ: 'clinical.read',
  CLINICAL_WRITE: 'clinical.write',
  CLINICAL_DELETE: 'clinical.delete',
  // Agenda
  SCHEDULE_READ: 'schedule.read',
  SCHEDULE_WRITE: 'schedule.write',
  SCHEDULE_AVAILABILITY: 'schedule.availability',
  // Financeiro
  FINANCE_READ: 'finance.read',
  FINANCE_WRITE: 'finance.write',
  FINANCE_REPORTS: 'finance.reports',
  // Comunicação e automação
  MESSAGES_READ: 'messages.read',
  MESSAGES_SEND: 'messages.send',
  AUTOMATIONS_MANAGE: 'automations.manage',
  // Relatórios, documentos, tarefas
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_WRITE: 'documents.write',
  TASKS_MANAGE: 'tasks.manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: { code: PermissionCode; module: string; description: string }[] = [
  { code: 'dashboard.view', module: 'Dashboard', description: 'Ver dashboard e resumo executivo' },
  { code: 'users.manage', module: 'Plataforma', description: 'Criar, editar e desativar usuários' },
  { code: 'roles.manage', module: 'Plataforma', description: 'Configurar papéis e permissões' },
  { code: 'settings.manage', module: 'Plataforma', description: 'Configurar clínica, horários, valores e regras' },
  { code: 'integrations.manage', module: 'Plataforma', description: 'Configurar WhatsApp, e-mail e demais integrações' },
  { code: 'audit.view', module: 'Plataforma', description: 'Consultar registros de auditoria' },
  { code: 'data.export', module: 'Plataforma', description: 'Exportar dados de titulares (LGPD)' },
  { code: 'leads.read', module: 'CRM', description: 'Ver leads e funil' },
  { code: 'leads.write', module: 'CRM', description: 'Cadastrar e mover leads' },
  { code: 'patients.read', module: 'Pacientes', description: 'Ver dados cadastrais dos pacientes vinculados' },
  { code: 'patients.read_all', module: 'Pacientes', description: 'Ver todos os pacientes da clínica' },
  { code: 'patients.write', module: 'Pacientes', description: 'Cadastrar e editar pacientes' },
  { code: 'patients.delete', module: 'Pacientes', description: 'Excluir ou anonimizar pacientes' },
  { code: 'clinical.read', module: 'Prontuário', description: 'Ver dados clínicos, avaliações e evoluções' },
  { code: 'clinical.write', module: 'Prontuário', description: 'Registrar avaliações, planos e evoluções' },
  { code: 'clinical.delete', module: 'Prontuário', description: 'Excluir registros clínicos (com motivo)' },
  { code: 'schedule.read', module: 'Agenda', description: 'Ver agenda' },
  { code: 'schedule.write', module: 'Agenda', description: 'Agendar, remarcar, cancelar e confirmar' },
  { code: 'schedule.availability', module: 'Agenda', description: 'Configurar disponibilidade e bloqueios' },
  { code: 'finance.read', module: 'Financeiro', description: 'Ver pagamentos e contas a receber' },
  { code: 'finance.write', module: 'Financeiro', description: 'Registrar pagamentos, pacotes e despesas' },
  { code: 'finance.reports', module: 'Financeiro', description: 'Ver faturamento, projeções e despesas' },
  { code: 'messages.read', module: 'Comunicação', description: 'Ver conversas e histórico de mensagens' },
  { code: 'messages.send', module: 'Comunicação', description: 'Enviar mensagens' },
  { code: 'automations.manage', module: 'Comunicação', description: 'Configurar automações e textos automáticos' },
  { code: 'reports.view', module: 'Relatórios', description: 'Ver relatórios' },
  { code: 'reports.export', module: 'Relatórios', description: 'Exportar relatórios (PDF/CSV)' },
  { code: 'documents.read', module: 'Documentos', description: 'Ver documentos (clínicos exigem também prontuário)' },
  { code: 'documents.write', module: 'Documentos', description: 'Enviar e organizar documentos' },
  { code: 'tasks.manage', module: 'Tarefas', description: 'Criar e concluir tarefas' },
];

const ALL = PERMISSION_CATALOG.map((p) => p.code);

export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: PermissionCode[] }[] = [
  {
    key: 'ADMIN',
    name: 'Administrador',
    description: 'Acesso total ao sistema',
    permissions: ALL,
  },
  {
    key: 'PHYSIO',
    name: 'Fisioterapeuta',
    description: 'Atende pacientes, registra avaliações e evoluções',
    permissions: [
      'dashboard.view',
      'leads.read',
      'leads.write',
      'patients.read',
      'patients.write',
      'clinical.read',
      'clinical.write',
      'schedule.read',
      'schedule.write',
      'messages.read',
      'messages.send',
      'reports.view',
      'documents.read',
      'documents.write',
      'tasks.manage',
    ],
  },
  {
    key: 'RECEPTION',
    name: 'Recepção',
    description: 'Cadastros, agenda, confirmações, mensagens e pagamentos — sem acesso clínico por padrão',
    permissions: [
      'dashboard.view',
      'leads.read',
      'leads.write',
      'patients.read',
      'patients.read_all',
      'patients.write',
      'schedule.read',
      'schedule.write',
      'finance.read',
      'finance.write',
      'messages.read',
      'messages.send',
      'documents.read',
      'documents.write',
      'tasks.manage',
    ],
  },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Aluguel',
  'Funcionários',
  'Equipamentos',
  'Materiais',
  'Marketing',
  'Software',
  'Impostos',
  'Outros',
];

/** Calcula permissões efetivas: papel + concedidas − negadas. */
export function effectivePermissions(
  rolePermissions: string[],
  overrides: { permissionCode: string; granted: boolean }[],
): string[] {
  const set = new Set(rolePermissions);
  for (const o of overrides) {
    if (o.granted) set.add(o.permissionCode);
    else set.delete(o.permissionCode);
  }
  return [...set].sort();
}
