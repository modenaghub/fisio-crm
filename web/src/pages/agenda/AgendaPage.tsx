import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Ban, ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney } from '@/lib/format';
import {
  addDaysKey,
  dayKey,
  dayMonth,
  fromLocal,
  hhmm,
  layoutLanes,
  minutesOfDay,
  monthGrid,
  rangeLabel,
  STATUS_STYLE,
  weekdayOf,
  weekdayShort,
  weekStart,
  type Appointment,
} from '@/lib/agenda';
import { Button, Checkbox, ConfirmDialog, ErrorState, PageHeader, Select } from '@/components/ui';
import { useProfessionals } from '@/components/crm-forms';
import { AppointmentDetailModal, BlockModal, conflictInfo, invalidateAgenda, NewAppointmentModal } from '@/components/agenda-forms';

type View = 'day' | 'week' | 'month';
const HOUR_PX = 64;
const SNAP = 15;

interface Column { key: string; date: string; professionalId?: string; label: string; sub?: string }

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const f = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return m;
}

function EventBlock({ a, top, height, left, width, onOpen }: { a: Appointment; top: number; height: number; left: string; width: string; onOpen: () => void }) {
  const faded = a.status === 'CANCELLED' || a.status === 'NO_SHOW';
  const block = a.kind === 'BLOCK';
  const color = a.professional.color;
  const compact = height < 40;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/appointment', JSON.stringify({ id: a.id, duration: a.durationMinutes }));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      style={{ top, height: Math.max(20, height - 2), left, width, borderLeftColor: block ? '#94a3b8' : color, ...(block ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(148,163,184,.18) 0 6px, transparent 6px 12px)' } : {}) }}
      className={clsx(
        'absolute z-10 cursor-pointer overflow-hidden rounded-md border border-l-4 px-1.5 py-0.5 text-left text-xs shadow-sm transition hover:z-20 hover:shadow-md',
        block ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-slate-200 bg-white text-slate-800',
        faded && 'opacity-50',
        a.status === 'DONE' && 'bg-slate-50',
      )}
    >
      <div className={clsx('flex items-center gap-1', compact ? '' : 'mb-0.5')}>
        <span className={clsx('size-1.5 shrink-0 rounded-full', STATUS_STYLE[a.status].dot)} />
        <span className={clsx('truncate font-semibold', faded && 'line-through')}>{block ? a.notes || 'Bloqueio' : a.patient?.name}</span>
        {a.seriesId && !compact && <Repeat className="size-3 shrink-0 text-slate-400" />}
      </div>
      {!compact && (
        <p className="truncate text-[11px] text-slate-500 tabular">
          {hhmm(minutesOfDay(a.startsAt))}–{hhmm(minutesOfDay(a.endsAt))}{a.service && ` · ${a.service.name}`}
        </p>
      )}
      {height > 70 && !block && <p className="truncate text-[11px] text-slate-400">{a.professional.name.split(' ')[0]} · {STATUS_STYLE[a.status].label}</p>}
    </div>
  );
}

export function AgendaPage() {
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const isMobile = useIsMobile();
  const pros = useProfessionals();
  const [view, setView] = useState<View>(isMobile ? 'day' : 'week');
  const [cursor, setCursor] = useState(dayKey(new Date()));
  const [professionalId, setProfessionalId] = useState<string>(() => (can('patients.read_all') ? '' : me?.user.id ?? ''));
  const [showCancelled, setShowCancelled] = useState(false);
  const [creating, setCreating] = useState<{ date?: string; minutes?: number; professionalId?: string } | null>(null);
  const [blocking, setBlocking] = useState<{ date?: string; minutes?: number; professionalId?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragHint, setDragHint] = useState<{ col: string; minutes: number } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; startsAt: string; professionalId?: string; message: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => {
    if (view === 'day') return { from: cursor, to: cursor };
    if (view === 'week') { const s = weekStart(cursor); return { from: s, to: addDaysKey(s, 6) }; }
    const g = monthGrid(cursor);
    return { from: g[0], to: g[41] };
  }, [view, cursor]);
  const fromIso = fromLocal(range.from, 0).toISOString();
  const toIso = fromLocal(addDaysKey(range.to, 1), 0).toISOString();
  const qs = new URLSearchParams({ from: fromIso, to: toIso });
  if (professionalId) qs.set('professionalId', professionalId);

  const appts = useQuery({ queryKey: ['agenda', 'list', qs.toString()], queryFn: () => api<Appointment[]>(`/appointments?${qs}`), placeholderData: (p) => p });
  const working = useQuery({ queryKey: ['agenda', 'working', qs.toString()], queryFn: () => api<{ start: string; end: string }[]>(`/schedule/working?${qs}`), enabled: view !== 'month' });

  // Bloqueios removidos nunca aparecem; cancelados e faltas só quando pedido.
  const visible = (appts.data ?? []).filter((a) => (a.kind === 'BLOCK' ? a.status === 'BLOCKED' : showCancelled || !['CANCELLED', 'NO_SHOW'].includes(a.status)));

  const move = useMutation({
    mutationFn: (p: { id: string; startsAt: string; professionalId?: string; force?: boolean }) => api(`/appointments/${p.id}`, { method: 'PATCH', body: { startsAt: p.startsAt, professionalId: p.professionalId, force: p.force } }),
    onSuccess: () => { invalidateAgenda(qc); toast.success('Agendamento movido'); },
    onError: (e, v) => {
      const c = conflictInfo(e);
      if (c?.canForce) setPendingMove({ id: v.id, startsAt: v.startsAt, professionalId: v.professionalId, message: c.message });
      else toast.error(c?.message ?? e.message);
    },
  });

  // Colunas: semana = dias; dia com "todos" = um por profissional; dia com profissional = uma.
  const columns: Column[] = useMemo(() => {
    if (view === 'week') {
      const s = weekStart(cursor);
      const days = Array.from({ length: 7 }, (_, i) => addDaysKey(s, i));
      const hasSunday = (appts.data ?? []).some((a) => weekdayOf(dayKey(a.startsAt)) === 0) || (working.data ?? []).some((w) => weekdayOf(dayKey(w.start)) === 0);
      return days.filter((d) => hasSunday || weekdayOf(d) !== 0).map((d) => ({ key: d, date: d, label: weekdayShort(d), sub: dayMonth(d) }));
    }
    if (view === 'day' && !professionalId && (pros.data?.length ?? 0) > 1 && !isMobile) {
      return (pros.data ?? []).map((p) => ({ key: p.id, date: cursor, professionalId: p.id, label: p.name.split(' ').slice(0, 2).join(' ') }));
    }
    return [{ key: cursor, date: cursor, label: weekdayShort(cursor), sub: dayMonth(cursor) }];
  }, [view, cursor, professionalId, pros.data, appts.data, working.data, isMobile]);

  // Faixa de horas: do primeiro início ao último término (padrão 7h–20h).
  const [startMin, endMin] = useMemo(() => {
    let s = 7 * 60, e = 20 * 60;
    for (const w of working.data ?? []) { s = Math.min(s, minutesOfDay(w.start)); e = Math.max(e, minutesOfDay(w.end) || 24 * 60); }
    for (const a of visible) { s = Math.min(s, minutesOfDay(a.startsAt)); e = Math.max(e, minutesOfDay(a.endsAt) || 24 * 60); }
    return [Math.floor(s / 60) * 60, Math.min(24 * 60, Math.ceil(e / 60) * 60)];
  }, [working.data, visible]);
  const toY = (min: number) => ((min - startMin) / 60) * HOUR_PX;

  useEffect(() => {
    if (view !== 'month' && scrollRef.current) {
      const now = minutesOfDay(new Date());
      scrollRef.current.scrollTop = Math.max(0, toY(Math.max(startMin, Math.min(now, 8 * 60))) - 16);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cursor, startMin]);

  const step = (n: number) => setCursor((c) => (view === 'day' ? addDaysKey(c, n) : view === 'week' ? addDaysKey(c, 7 * n) : (() => { const d = new Date(`${c.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); })()));
  const minuteFromEvent = (e: React.MouseEvent | React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    return Math.max(startMin, Math.min(endMin - SNAP, startMin + Math.round(((y / HOUR_PX) * 60) / SNAP) * SNAP));
  };
  const today = dayKey(new Date());
  const nowMin = minutesOfDay(new Date());

  const workingFor = (col: Column) =>
    (working.data ?? []).filter((w) => dayKey(w.start) === col.date).map((w) => ({ s: minutesOfDay(w.start), e: minutesOfDay(w.end) || 24 * 60 }));
  const itemsFor = (col: Column) => visible.filter((a) => dayKey(a.startsAt) === col.date && (!col.professionalId || a.professional.id === col.professionalId));

  const summary = useMemo(() => {
    const list = (appts.data ?? []).filter((a) => a.kind === 'APPOINTMENT' && ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'DONE'].includes(a.status));
    return { count: list.length, value: list.reduce((n, a) => n + a.priceCents, 0), confirmed: list.filter((a) => a.status === 'CONFIRMED').length };
  }, [appts.data]);

  return (
    <>
      <PageHeader
        title="Agenda"
        description={appts.data ? `${summary.count} atendimento(s) no período · ${summary.confirmed} confirmado(s) · ${formatMoney(summary.value)} previstos` : undefined}
        actions={can('schedule.write') && (
          <>
            <Button variant="outline" icon={<Ban className="size-4" />} onClick={() => setBlocking({ date: cursor })}>Bloquear horário</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating({ date: cursor >= today ? cursor : today, professionalId: professionalId || undefined })}>Novo agendamento</Button>
          </>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(today)}>Hoje</Button>
          <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="Próximo"><ChevronRight className="size-4" /></Button>
        </div>
        <h2 className="order-first min-w-0 basis-full truncate text-base font-semibold text-slate-900 first-letter:uppercase sm:order-none sm:flex-1 sm:basis-auto">{rangeLabel(view, cursor)}</h2>
        <div className="w-full sm:w-56">
          <Select className="h-9" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} aria-label="Profissional">
            <option value="">Todos os profissionais</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              {{ day: 'Dia', week: 'Semana', month: 'Mês' }[v]}
            </button>
          ))}
        </div>
        <Checkbox checked={showCancelled} onChange={setShowCancelled} label="Mostrar cancelados e faltas" />
      </div>

      {appts.isError && <ErrorState message={appts.error.message} onRetry={() => appts.refetch()} />}

      {view === 'month' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid(cursor).map((d) => {
              const items = visible.filter((a) => dayKey(a.startsAt) === d).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
              const inMonth = d.slice(0, 7) === cursor.slice(0, 7);
              return (
                <button
                  key={d}
                  onClick={() => { setCursor(d); setView('day'); }}
                  className={clsx('min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top hover:bg-brand-50/40 sm:min-h-28', !inMonth && 'bg-slate-50/60 text-slate-400')}
                >
                  <span className={clsx('inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold', d === today ? 'bg-brand-700 text-white' : '')}>{Number(d.slice(8))}</span>
                  <div className="mt-1 space-y-0.5">
                    {items.slice(0, 3).map((a) => (
                      <div key={a.id} className="hidden truncate rounded px-1 text-[11px] sm:block" style={{ background: `${a.professional.color}14`, color: '#334155' }}>
                        {hhmm(minutesOfDay(a.startsAt))} {a.kind === 'BLOCK' ? 'Bloqueio' : a.patient?.name.split(' ')[0]}
                      </div>
                    ))}
                    {items.length > 3 && <p className="hidden text-[11px] text-slate-500 sm:block">+{items.length - 3} mais</p>}
                    {items.length > 0 && <p className="text-[11px] font-medium text-brand-700 sm:hidden">{items.length}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Cabeçalho das colunas */}
          <div className="flex border-b border-slate-200 bg-slate-50/80">
            <div className="w-14 shrink-0" />
            {columns.map((c) => (
              <div key={c.key} className={clsx('min-w-0 flex-1 border-l border-slate-200 px-2 py-2 text-center', c.date === today && !c.professionalId && 'bg-brand-50')}>
                <p className={clsx('truncate text-xs font-semibold uppercase tracking-wide', c.date === today && !c.professionalId ? 'text-brand-800' : 'text-slate-500')}>{c.label}</p>
                {c.sub && <p className="text-sm font-semibold text-slate-900 tabular">{c.sub}</p>}
              </div>
            ))}
          </div>
          <div ref={scrollRef} className="relative max-h-[calc(100dvh-270px)] min-h-96 overflow-y-auto">
            <div className="flex" style={{ height: toY(endMin) }}>
              {/* Régua de horas */}
              <div className="relative w-14 shrink-0">
                {Array.from({ length: (endMin - startMin) / 60 }, (_, i) => (
                  <span key={i} className="absolute right-2 -translate-y-2 text-[11px] text-slate-400 tabular" style={{ top: i * HOUR_PX }}>{i === 0 ? '' : hhmm(startMin + i * 60)}</span>
                ))}
              </div>
              {columns.map((col) => {
                const work = workingFor(col);
                const lanes = layoutLanes(itemsFor(col));
                return (
                  <div
                    key={col.key}
                    className="relative min-w-0 flex-1 border-l border-slate-200"
                    style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, #f1f5f9 ${HOUR_PX - 1}px, #f1f5f9 ${HOUR_PX}px)` }}
                    onClick={(e) => {
                      if (!can('schedule.write')) return;
                      const m = minuteFromEvent(e);
                      setCreating({ date: col.date, minutes: m, professionalId: col.professionalId ?? (professionalId || undefined) });
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragHint({ col: col.key, minutes: minuteFromEvent(e) }); }}
                    onDragLeave={() => setDragHint(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragHint(null);
                      const raw = e.dataTransfer.getData('text/appointment');
                      if (!raw || !can('schedule.write')) return;
                      const { id } = JSON.parse(raw) as { id: string };
                      move.mutate({ id, startsAt: fromLocal(col.date, minuteFromEvent(e)).toISOString(), professionalId: col.professionalId });
                    }}
                  >
                    {/* Fora do horário de atendimento: sombreado */}
                    {(() => {
                      const blocks: [number, number][] = [];
                      let cur = startMin;
                      for (const w of [...work].sort((a, b) => a.s - b.s)) { if (w.s > cur) blocks.push([cur, w.s]); cur = Math.max(cur, w.e); }
                      if (cur < endMin) blocks.push([cur, endMin]);
                      return blocks.map(([s, e]) => <div key={s} className="pointer-events-none absolute inset-x-0 bg-slate-100/70" style={{ top: toY(s), height: toY(e) - toY(s) }} />);
                    })()}
                    {col.date === today && nowMin >= startMin && nowMin <= endMin && (
                      <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: toY(nowMin) }}>
                        <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                      </div>
                    )}
                    {dragHint?.col === col.key && (
                      <div className="pointer-events-none absolute inset-x-1 z-0 rounded border-2 border-dashed border-brand-400 bg-brand-50/60" style={{ top: toY(dragHint.minutes), height: HOUR_PX * (50 / 60) }}>
                        <span className="px-1 text-[11px] font-semibold text-brand-800">{hhmm(dragHint.minutes)}</span>
                      </div>
                    )}
                    {lanes.map(({ item, lane, lanes: n }) => {
                      const s = minutesOfDay(item.startsAt);
                      const e = minutesOfDay(item.endsAt) || 24 * 60;
                      return (
                        <EventBlock key={item.id} a={item} top={toY(s)} height={toY(e) - toY(s)} left={`calc(${(lane / n) * 100}% + 2px)`} width={`calc(${100 / n}% - 4px)`} onOpen={() => setOpenId(item.id)} />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'NO_SHOW', 'CANCELLED', 'BLOCKED'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className={clsx('size-2 rounded-full', STATUS_STYLE[s].dot)} />{STATUS_STYLE[s].label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-slate-100 ring-1 ring-slate-200" />Fora do horário</span>
        {can('schedule.write') && view !== 'month' && <span>· Clique num horário vazio para agendar; arraste para mover.</span>}
      </div>

      {creating && <NewAppointmentModal defaults={creating} onClose={() => setCreating(null)} />}
      {blocking && <BlockModal defaults={blocking} onClose={() => setBlocking(null)} />}
      {openId && <AppointmentDetailModal id={openId} onClose={() => setOpenId(null)} />}
      <ConfirmDialog
        open={!!pendingMove}
        onClose={() => setPendingMove(null)}
        onConfirm={() => { if (pendingMove) move.mutate({ ...pendingMove, force: true }); setPendingMove(null); }}
        tone="primary"
        title="Mover mesmo assim?"
        description={pendingMove?.message}
        confirmLabel="Mover"
      />
    </>
  );
}
