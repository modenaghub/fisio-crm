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

export function maskCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function isValidCpf(value: string) {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

const TZ = 'America/Sao_Paulo';
export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'short' }) {
  if (!iso) return '—';
  // Datas puras (YYYY-MM-DD) não sofrem conversão de fuso.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return opts.dateStyle === 'short' && Object.keys(opts).length === 1 ? `${d}/${m}/${y}` : new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { ...opts, timeZone: 'UTC' });
  }
  return new Date(iso).toLocaleDateString('pt-BR', { ...opts, timeZone: TZ });
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function formatDayTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = localDateKey(new Date());
  const key = localDateKey(d);
  const tomorrow = localDateKey(new Date(Date.now() + 86400000));
  const day = key === today ? 'Hoje' : key === tomorrow ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
  return `${day}, ${formatTime(iso)}`;
}

/** Data local (fuso da clínica) no formato YYYY-MM-DD. */
export function localDateKey(d: Date) {
  return new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
}

export function onlyDigits(v: string | null | undefined) {
  return (v ?? '').replace(/\D/g, '');
}

export function whatsappLink(phone: string | null | undefined) {
  const d = onlyDigits(phone);
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}`;
}

/** "1 sessão" / "3 sessões". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
