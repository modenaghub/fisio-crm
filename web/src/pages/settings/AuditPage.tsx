import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, History, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { AUDIT_ACTION_LABELS, describeUserAgent, ENTITY_LABELS, formatDateTime } from '@/lib/format';
import type { AuditRow } from '@/lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, LoadingState, Select, type BadgeTone } from '@/components/ui';

const tone = (action: string): BadgeTone =>
  ({ CREATE: 'green', UPDATE: 'blue', DELETE: 'red', LOGIN_FAILED: 'amber', TOKEN_REUSE: 'red', PERMISSION_CHANGE: 'violet', LOGIN: 'slate', LOGOUT: 'slate', READ: 'brand' } as Record<string, BadgeTone>)[action] ?? 'slate';

const isOverride = (x: unknown): x is { permissionCode: string; granted: boolean } =>
  !!x && typeof x === 'object' && 'permissionCode' in x && 'granted' in x;

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v) && v.every(isOverride)) return v.length ? v.map((o) => `${o.granted ? 'Concede' : 'Nega'} ${o.permissionCode}`).join(', ') : 'Nenhuma exceção';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

export function AuditPage() {
  const [filters, setFilters] = useState({ search: '', action: '', entity: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const pageSize = 25;

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.search) params.set('search', filters.search);
  if (filters.action) params.set('action', filters.action);
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.from) params.set('from', new Date(filters.from + 'T00:00:00').toISOString());
  if (filters.to) params.set('to', new Date(filters.to + 'T23:59:59').toISOString());

  const q = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api<{ total: number; items: AuditRow[] }>(`/audit-logs?${params}`),
    placeholderData: keepPreviousData,
  });
  const entities = useQuery({ queryKey: ['audit-entities'], queryFn: () => api<string[]>('/audit-logs/entities') });
  const setF = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / pageSize));

  return (
    <Card>
      <CardHeader title="Auditoria" description="Registro permanente de quem fez o quê e quando. Não pode ser alterado nem apagado." />
      <div className="grid gap-3 border-b border-slate-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))_minmax(0,1.3fr)]">
        <div className="sm:col-span-2 xl:col-span-1">
          <Input leading={<Search className="size-4" />} placeholder="Buscar por descrição ou usuário" value={filters.search} onChange={(e) => setF('search', e.target.value)} />
        </div>
        <Select value={filters.action} onChange={(e) => setF('action', e.target.value)} aria-label="Ação">
          <option value="">Ação</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select value={filters.entity} onChange={(e) => setF('entity', e.target.value)} aria-label="Área">
          <option value="">Área</option>
          {entities.data?.map((e) => (
            <option key={e} value={e}>
              {ENTITY_LABELS[e] ?? e}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" aria-label="De" value={filters.from} onChange={(e) => setF('from', e.target.value)} />
          <Input type="date" aria-label="Até" value={filters.to} onChange={(e) => setF('to', e.target.value)} />
        </div>
      </div>

      {q.isLoading && <LoadingState rows={6} />}
      {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {q.data?.items.length === 0 && <EmptyState icon={<History className="size-6" />} title="Nenhum registro encontrado" description="Ajuste os filtros para ver outros períodos ou ações." />}

      {!!q.data?.items.length && (
        <ul className={clsx('divide-y divide-slate-100', q.isFetching && 'opacity-60')}>
          {q.data.items.map((a) => {
            const hasDetail = (a.changes && Object.keys(a.changes).length > 0) || a.metadata || a.ipAddress;
            const expanded = open === a.id;
            return (
              <Fragment key={a.id}>
                <li>
                  <button
                    type="button"
                    disabled={!hasDetail}
                    onClick={() => setOpen(expanded ? null : a.id)}
                    className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50/60 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <Badge tone={tone(a.action)} className="mt-0.5 shrink-0">
                      {AUDIT_ACTION_LABELS[a.action] ?? a.action}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800">{a.summary ?? `${a.action} ${a.entity}`}</p>
                      <p className="text-xs text-slate-500">
                        {a.actorName ?? 'Sistema'} · {ENTITY_LABELS[a.entity] ?? a.entity} · {formatDateTime(a.createdAt)}
                      </p>
                    </div>
                    {hasDetail && <ChevronDown className={clsx('mt-1 size-4 shrink-0 text-slate-400 transition-transform', expanded && 'rotate-180')} />}
                  </button>
                  {expanded && (
                    <div className="space-y-3 bg-slate-50/70 px-5 py-4 text-xs">
                      {a.changes && Object.keys(a.changes).length > 0 && (
                        <table className="w-full max-w-3xl">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="py-1 pr-4 font-medium">Campo</th>
                              <th className="py-1 pr-4 font-medium">Antes</th>
                              <th className="py-1 font-medium">Depois</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(a.changes).map(([k, c]) => (
                              <tr key={k} className="border-t border-slate-200/70 align-top">
                                <td className="py-1.5 pr-4 font-mono text-slate-600">{k}</td>
                                <td className="py-1.5 pr-4 text-red-700">{show(c.from)}</td>
                                <td className="py-1.5 text-emerald-700">{show(c.to)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {a.metadata && <pre className="max-w-3xl overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-slate-600 ring-1 ring-slate-200">{JSON.stringify(a.metadata, null, 2)}</pre>}
                      <p className="text-slate-500">
                        IP {a.ipAddress ?? '—'} · {describeUserAgent(a.userAgent)}
                        {a.entityId && <> · ID {a.entityId}</>}
                      </p>
                    </div>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}

      {q.data && q.data.total > pageSize && (
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>
            {q.data.total.toLocaleString('pt-BR')} registros · página {page} de {pages}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
