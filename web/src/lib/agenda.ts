/** Utilitários de data da agenda. Tudo no fuso da clínica (America/Sao_Paulo, UTC−3). */
export const OFFSET_MIN = -180;

export interface Appointment {
  id: string;
  kind: 'APPOINTMENT' | 'BLOCK';
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED' | 'BLOCKED';
  statusLabel: string;
  priceCents: number;
  notes: string | null;
  cancelReason: string | null;
  seriesId: string | null;
  rescheduledFromId: string | null;
  patient: { id: string; name: string; photoUrl: string | null; phone: string | null; whatsapp: string | null } | null;
  professional: { id: string; name: string; color: string };
  service: { id: string; name: string; kind: string; color: string | null } | null;
  package: { id: string; name: string } | null;
  session: { id: string; sessionNumber: number } | null;
  hasEvaluation: boolean;
}

/** "YYYY-MM-DD" local de um instante. */
export function dayKey(d: Date | string) {
  const t = typeof d === 'string' ? new Date(d) : d;
  return new Date(t.getTime() + OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Minutos desde a meia-noite local. */
export function minutesOfDay(d: Date | string) {
  const t = new Date(new Date(d).getTime() + OFFSET_MIN * 60_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** Instante a partir de dia local + minutos. */
export function fromLocal(key: string, minutes: number) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${key}T${hh}:${mm}:00-03:00`);
}

export function addDaysKey(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();

/** Segunda-feira da semana do dia informado. */
export function weekStart(key: string) {
  const wd = weekdayOf(key);
  return addDaysKey(key, wd === 0 ? -6 : 1 - wd);
}

export function monthGrid(key: string) {
  const first = `${key.slice(0, 7)}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDaysKey(start, i));
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const weekdayShort = (key: string) => WD[weekdayOf(key)];
export const monthName = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1];
export const dayMonth = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

export function rangeLabel(view: 'day' | 'week' | 'month', key: string) {
  if (view === 'day') return `${weekdayShort(key)}, ${Number(key.slice(8, 10))} de ${monthName(key)} de ${key.slice(0, 4)}`;
  if (view === 'month') return `${monthName(key)} de ${key.slice(0, 4)}`;
  const s = weekStart(key);
  const e = addDaysKey(s, 6);
  return s.slice(5, 7) === e.slice(5, 7)
    ? `${Number(s.slice(8, 10))} a ${Number(e.slice(8, 10))} de ${monthName(s)} de ${s.slice(0, 4)}`
    : `${Number(s.slice(8, 10))} de ${monthName(s)} a ${Number(e.slice(8, 10))} de ${monthName(e)}`;
}

export const STATUS_STYLE: Record<Appointment['status'], { label: string; chip: string; dot: string }> = {
  SCHEDULED: { label: 'Agendado', chip: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500' },
  CONFIRMED: { label: 'Confirmado', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500' },
  IN_PROGRESS: { label: 'Em atendimento', chip: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  DONE: { label: 'Realizado', chip: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  CANCELLED: { label: 'Cancelado', chip: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-400' },
  NO_SHOW: { label: 'Faltou', chip: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-600' },
  RESCHEDULED: { label: 'Reagendado', chip: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  BLOCKED: { label: 'Bloqueio', chip: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-500' },
};

/** Distribui eventos sobrepostos em colunas lado a lado. */
export function layoutLanes<T extends { startsAt: string; endsAt: string }>(items: T[]) {
  const sorted = [...items].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const out: { item: T; lane: number; lanes: number }[] = [];
  let group: { item: T; lane: number }[] = [];
  let groupEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => out.push({ ...g, lanes }));
    group = [];
  };
  for (const item of sorted) {
    const s = +new Date(item.startsAt);
    const e = +new Date(item.endsAt);
    if (group.length && s >= groupEnd) flush();
    const used = new Set(group.filter((g) => +new Date(g.item.endsAt) > s).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ item, lane });
    groupEnd = Math.max(groupEnd, e);
  }
  if (group.length) flush();
  return out;
}
