import { useEffect, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Button, Input, Select, Switch } from './ui';
import { parseMoneyToCents, SERVICE_KIND_LABELS, WEEKDAYS } from '@/lib/format';
import type { DayHours, ServiceKind } from '@/lib/types';

// ───────────────────────── Valor em reais ─────────────────────────

export function MoneyInput({ cents, onChange, invalid, id }: { cents: number | null; onChange: (c: number | null) => void; invalid?: boolean; id?: string }) {
  const toText = (c: number | null) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const [text, setText] = useState(toText(cents));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(toText(cents));
  }, [cents, focused]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      leading="R$"
      invalid={invalid}
      value={text}
      placeholder="0,00"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(toText(cents));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMoneyToCents(e.target.value));
      }}
    />
  );
}

// ───────────────────────── Horários de atendimento ─────────────────────────

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function hoursErrors(days: DayHours[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const d of days) {
    const sorted = [...d.intervals].sort((a, b) => toMin(a.start) - toMin(b.start));
    for (let i = 0; i < sorted.length; i++) {
      if (!sorted[i].start || !sorted[i].end) errors[d.weekday] = 'Preencha início e fim';
      else if (toMin(sorted[i].start) >= toMin(sorted[i].end)) errors[d.weekday] = 'O início deve ser antes do fim';
      else if (i > 0 && toMin(sorted[i].start) < toMin(sorted[i - 1].end)) errors[d.weekday] = 'Há horários sobrepostos';
    }
  }
  return errors;
}

export function weeklyHours(days: DayHours[]) {
  const min = days.flatMap((d) => d.intervals).reduce((n, i) => n + Math.max(0, toMin(i.end) - toMin(i.start)), 0);
  return min / 60;
}

export const PRESET_HOURS: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  intervals: weekday >= 1 && weekday <= 5 ? [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] : [],
}));

export function HoursEditor({ value, onChange }: { value: DayHours[]; onChange: (v: DayHours[]) => void }) {
  const errors = hoursErrors(value);
  // Exibe de segunda a domingo.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const setDay = (weekday: number, intervals: DayHours['intervals']) =>
    onChange(value.map((d) => (d.weekday === weekday ? { ...d, intervals } : d)));

  const copyToWeekdays = (from: DayHours) =>
    onChange(value.map((d) => (d.weekday >= 1 && d.weekday <= 5 ? { ...d, intervals: from.intervals.map((i) => ({ ...i })) } : d)));

  return (
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {order.map((wd) => {
        const day = value.find((d) => d.weekday === wd) ?? { weekday: wd, intervals: [] };
        const open = day.intervals.length > 0;
        return (
          <div key={wd} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
            <div className="flex w-36 shrink-0 items-center gap-3 pt-1.5">
              <Switch
                checked={open}
                label={`Atende ${WEEKDAYS[wd]}`}
                onChange={(on) => setDay(wd, on ? [{ start: '08:00', end: '12:00' }] : [])}
              />
              <span className={clsx('text-sm font-medium', open ? 'text-slate-900' : 'text-slate-400')}>{WEEKDAYS[wd]}</span>
            </div>
            <div className="flex-1 space-y-2">
              {!open && <p className="pt-2 text-sm text-slate-400">Fechado</p>}
              {day.intervals.map((iv, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label="Início"
                    value={iv.start}
                    className="w-28"
                    invalid={!!errors[wd]}
                    onChange={(e) => setDay(wd, day.intervals.map((x, i) => (i === idx ? { ...x, start: e.target.value } : x)))}
                  />
                  <span className="text-sm text-slate-400">às</span>
                  <Input
                    type="time"
                    aria-label="Fim"
                    value={iv.end}
                    className="w-28"
                    invalid={!!errors[wd]}
                    onChange={(e) => setDay(wd, day.intervals.map((x, i) => (i === idx ? { ...x, end: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    onClick={() => setDay(wd, day.intervals.filter((_, i) => i !== idx))}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remover horário"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {errors[wd] && <p className="text-xs font-medium text-red-600">{errors[wd]}</p>}
            </div>
            {open && (
              <div className="flex gap-1 sm:pt-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="size-4" />}
                  onClick={() => {
                    const last = day.intervals[day.intervals.length - 1];
                    setDay(wd, [...day.intervals, last && last.end < '14:00' ? { start: '14:00', end: '18:00' } : { start: '', end: '' }]);
                  }}
                >
                  Intervalo
                </Button>
                {wd >= 1 && wd <= 5 && (
                  <Button type="button" variant="ghost" size="sm" icon={<Copy className="size-4" />} onClick={() => copyToWeekdays(day)} title="Copiar para segunda a sexta">
                    Seg–Sex
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── Serviços e valores ─────────────────────────

export interface ServiceDraft {
  id?: string;
  name: string;
  kind: ServiceKind;
  durationMinutes: number;
  priceCents: number | null;
}

/** Só os campos aceitos pela API (os registros do servidor trazem campos extras). */
export function toServicePayload(list: ServiceDraft[]) {
  return list.map(({ id, name, kind, durationMinutes, priceCents }) => ({ id, name: name.trim(), kind, durationMinutes, priceCents: priceCents ?? 0 }));
}

export function servicesErrors(list: ServiceDraft[]) {
  const errors: Record<number, string> = {};
  const seen = new Map<string, number>();
  list.forEach((s, i) => {
    const key = s.name.trim().toLowerCase();
    if (key.length < 2) errors[i] = 'Informe o nome';
    else if (seen.has(key)) errors[i] = 'Nome repetido';
    else if (s.priceCents == null || s.priceCents < 0) errors[i] = 'Informe o valor';
    else if (!s.durationMinutes || s.durationMinutes < 5) errors[i] = 'Duração mínima de 5 min';
    seen.set(key, i);
  });
  return errors;
}

export function ServicesEditor({ value, onChange }: { value: ServiceDraft[]; onChange: (v: ServiceDraft[]) => void }) {
  const errors = servicesErrors(value);
  const update = (i: number, patch: Partial<ServiceDraft>) => onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-3">
      <div className="hidden grid-cols-[1fr_140px_110px_150px_40px] gap-3 px-1 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
        <span>Serviço</span>
        <span>Tipo</span>
        <span>Duração</span>
        <span>Valor</span>
        <span />
      </div>
      {value.map((s, i) => (
        <div key={s.id ?? `new-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 md:border-0 md:bg-transparent md:p-0">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_140px_110px_150px_40px] md:items-center">
            <Input className="col-span-2 md:col-span-1" aria-label="Nome do serviço" placeholder="Ex.: RPG, Pilates, Drenagem" value={s.name} invalid={!!errors[i]} onChange={(e) => update(i, { name: e.target.value })} />
            <Select aria-label="Tipo" value={s.kind} onChange={(e) => update(i, { kind: e.target.value as ServiceKind })}>
              {Object.entries(SERVICE_KIND_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <div className="relative">
              <Input
                type="number"
                min={5}
                step={5}
                aria-label="Duração em minutos"
                value={s.durationMinutes || ''}
                onChange={(e) => update(i, { durationMinutes: Number(e.target.value) })}
                className="pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">min</span>
            </div>
            <MoneyInput cents={s.priceCents} onChange={(c) => update(i, { priceCents: c })} invalid={!!errors[i] && errors[i] === 'Informe o valor'} />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              disabled={value.length === 1}
              className="justify-self-end rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Remover serviço"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          {errors[i] && <p className="mt-1 px-1 text-xs font-medium text-red-600">{errors[i]}</p>}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<Plus className="size-4" />}
        onClick={() => onChange([...value, { name: '', kind: 'SESSION', durationMinutes: 50, priceCents: null }])}
      >
        Adicionar serviço
      </Button>
    </div>
  );
}
