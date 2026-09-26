const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatMoney = (cents: number | null | undefined) => brl.format((cents ?? 0) / 100);

export function parseMoneyToCents(input: string): number | null {
  const clean = input.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatRelative(iso: string | null | undefined) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} dia${d > 1 ? 's' : ''}`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function maskCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function describeUserAgent(ua: string | null) {
  if (!ua) return 'Dispositivo desconhecido';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  BANK_TRANSFER: 'Transferência',
  BOLETO: 'Boleto',
  HEALTH_INSURANCE: 'Convênio',
  OTHER: 'Outros',
};

export const SERVICE_KIND_LABELS: Record<string, string> = {
  EVALUATION: 'Avaliação',
  SESSION: 'Sessão',
  PACKAGE: 'Pacote',
  OTHER: 'Outro',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  DELETE: 'Exclusão',
  RESTORE: 'Restauração',
  READ: 'Acesso',
  EXPORT: 'Exportação',
  LOGIN: 'Login',
  LOGIN_FAILED: 'Login recusado',
  LOGOUT: 'Logout',
  TOKEN_REUSE: 'Alerta de segurança',
  PASSWORD_RESET_REQUEST: 'Link de senha',
  PASSWORD_RESET: 'Senha redefinida',
  PASSWORD_CHANGE: 'Senha alterada',
  PERMISSION_CHANGE: 'Permissões',
};

export const ENTITY_LABELS: Record<string, string> = {
  organization: 'Clínica',
  user: 'Usuário',
  role: 'Perfil de acesso',
  session: 'Sessão de acesso',
  business_settings: 'Configurações',
  onboarding: 'Primeiro acesso',
  availability_rules: 'Horários',
  services: 'Serviços',
  unit: 'Unidade',
};
