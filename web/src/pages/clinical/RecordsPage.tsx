import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileHeart, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { STAGE_LABELS, STAGE_TONES } from '@/lib/labels';
import { Avatar, Badge, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader } from '@/components/ui';
import { PainBadge } from '@/components/clinical';

interface Row {
  id: string;
  name: string;
  photoUrl: string | null;
  crmStage: string;
  mainComplaint: string | null;
  diagnosis: string | null;
  lastEvaluation: { performedAt: string; painScale: number | null } | null;
  activePlan: { objective: string; plannedSessions: number | null } | null;
  lastSession: { performedAt: string; sessionNumber: number } | null;
  sessions: number;
  activeConditions: number;
}

export function RecordsPage() {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  const r = useQuery({ queryKey: ['clinical-overview', q], queryFn: () => api<Row[]>(`/clinical/overview${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  return (
    <>
      <PageHeader title="Prontuários" description="Resumo clínico dos pacientes. Cada consulta ao prontuário fica registrada." />
      <Card>
        <div className="border-b border-slate-100 p-4 sm:w-96"><Input leading={<Search className="size-4" />} placeholder="Buscar paciente" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        {r.isLoading && <LoadingState />}
        {r.isError && <ErrorState message={r.error.message} onRetry={() => r.refetch()} />}
        {r.data?.length === 0 && <EmptyState icon={<FileHeart className="size-6" />} title="Nenhum prontuário encontrado" />}
        <ul className="divide-y divide-slate-100">
          {r.data?.map((p) => (
            <li key={p.id}>
              <Link to={`/pacientes/${p.id}?aba=evolucoes`} className="grid gap-3 px-5 py-4 hover:bg-slate-50/60 md:grid-cols-[1.2fr_1.5fr_1fr]">
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} src={p.photoUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                    <Badge tone={STAGE_TONES[p.crmStage]}>{STAGE_LABELS[p.crmStage]}</Badge>
                  </div>
                </div>
                <div className="min-w-0 text-sm">
                  <p className="truncate text-slate-800">{p.diagnosis ?? p.mainComplaint ?? <span className="text-slate-400">Sem queixa registrada</span>}</p>
                  <p className="truncate text-xs text-slate-500">{p.activePlan ? `Plano: ${p.activePlan.objective}` : 'Sem plano ativo'}{p.activeConditions ? ` · ${p.activeConditions} condição(ões) ativa(s)` : ''}</p>
                </div>
                <div className="text-sm md:text-right">
                  <p className="text-slate-800 tabular">{p.sessions} sessões{p.activePlan?.plannedSessions ? ` de ${p.activePlan.plannedSessions}` : ''}</p>
                  <p className="flex items-center gap-2 text-xs text-slate-500 md:justify-end">
                    {p.lastSession ? `Última: ${formatDate(p.lastSession.performedAt)}` : 'Nenhuma sessão'}
                    {p.lastEvaluation && <PainBadge value={p.lastEvaluation.painScale} />}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
