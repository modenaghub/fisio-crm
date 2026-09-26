import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDayTime, formatMoney } from '@/lib/format';
import { PATIENT_STAGES, STAGE_LABELS, STAGE_TONES } from '@/lib/labels';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select } from '@/components/ui';
import { PatientFormModal, useProfessionals } from '@/components/crm-forms';

export interface PatientRow {
  id: string;
  code: string;
  name: string;
  photoUrl: string | null;
  age: number | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  crmStage: string;
  responsible: { id: string; name: string } | null;
  nextAppointment: { startsAt: string; service: string | null } | null;
  lastSessionAt: string | null;
  sessionsDone: number;
  activePackage: { name: string; remaining: number; contracted: number } | null;
  balanceDueCents: number;
}

export function PatientsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const pros = useProfessionals();
  const pageSize = 25;

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
  if (search.trim().length >= 2) params.set('search', search.trim());
  if (stage) params.set('stage', stage);
  if (responsibleId) params.set('responsibleId', responsibleId);
  const q = useQuery({
    queryKey: ['patients', params.toString()],
    queryFn: () => api<{ total: number; items: PatientRow[] }>(`/patients?${params}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / pageSize));
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <>
      <PageHeader
        title="Pacientes"
        description={q.data ? `${q.data.total} paciente${q.data.total === 1 ? '' : 's'}${can('patients.read_all') ? '' : ' sob seus cuidados'}` : undefined}
        actions={can('patients.write') && <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Novo paciente</Button>}
      />
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <Input leading={<Search className="size-4" />} placeholder="Nome, CPF, telefone, e-mail ou código" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
          <Select value={stage} onChange={(e) => reset(setStage)(e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            {PATIENT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </Select>
          <Select value={responsibleId} onChange={(e) => reset(setResponsibleId)(e.target.value)} aria-label="Responsável">
            <option value="">Todos os profissionais</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
            <option value="name">Ordem alfabética</option>
            <option value="recent">Cadastro mais recente</option>
            <option value="code">Código</option>
          </Select>
        </div>

        {q.isLoading && <LoadingState rows={6} />}
        {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
        {q.data?.items.length === 0 && (
          <EmptyState
            icon={<Users className="size-6" />}
            title={search || stage || responsibleId ? 'Nenhum paciente encontrado' : 'Nenhum paciente cadastrado'}
            description={search || stage || responsibleId ? 'Ajuste a busca ou os filtros.' : 'Cadastre o primeiro paciente ou converta um lead no CRM.'}
            action={!search && can('patients.write') && <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Novo paciente</Button>}
          />
        )}
        {!!q.data?.items.length && (
          <table className={clsx('w-full text-sm', q.isFetching && 'opacity-70')}>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">Paciente</th>
                <th className="hidden px-3 py-2.5 md:table-cell">Status</th>
                <th className="hidden px-3 py-2.5 lg:table-cell">Próxima sessão</th>
                <th className="hidden px-3 py-2.5 xl:table-cell">Sessões</th>
                <th className="hidden px-3 py-2.5 lg:table-cell">Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.items.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/pacientes/${p.id}`)} className="cursor-pointer hover:bg-slate-50/70">
                  <td className="w-full max-w-0 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={p.name} src={p.photoUrl} size="sm" />
                      <div className="min-w-0">
                        <Link to={`/pacientes/${p.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-slate-900 hover:text-brand-700">{p.name}</Link>
                        <p className="truncate text-xs text-slate-500">
                          {p.code}{p.age !== null && ` · ${p.age} anos`}{(p.whatsapp || p.phone) && ` · ${p.whatsapp ?? p.phone}`}
                        </p>
                        <div className="mt-1 md:hidden"><Badge tone={STAGE_TONES[p.crmStage]}>{STAGE_LABELS[p.crmStage]}</Badge></div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell"><Badge tone={STAGE_TONES[p.crmStage]}>{STAGE_LABELS[p.crmStage]}</Badge></td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-slate-600 lg:table-cell">{p.nextAppointment ? formatDayTime(p.nextAppointment.startsAt) : <span className="text-slate-400">—</span>}</td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-slate-600 xl:table-cell tabular">
                    {p.sessionsDone} realizadas{p.activePackage && <span className="text-slate-400"> · {p.activePackage.remaining} no pacote</span>}
                    {p.balanceDueCents > 0 && <span className="block text-xs text-amber-700">Em aberto: {formatMoney(p.balanceDueCents)}</span>}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-slate-600 lg:table-cell">{p.responsible?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {q.data && q.data.total > pageSize && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span>Página {page} de {pages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Anterior"><ChevronLeft className="size-4" /></Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima"><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </Card>
      {creating && <PatientFormModal onClose={() => setCreating(false)} onSaved={(id) => navigate(`/pacientes/${id}`)} />}
    </>
  );
}
