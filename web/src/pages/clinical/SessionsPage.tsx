import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, localDateKey } from '@/lib/format';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select } from '@/components/ui';
import { PainBadge, SessionFormModal, type SessionRow } from '@/components/clinical';
import { PatientPicker, type PickedPatient } from '@/components/PatientPicker';
import { useProfessionals } from '@/components/crm-forms';
import { TodayAppointments } from './TodayAppointments';

export function SessionsPage() {
  const { can, me } = useAuth();
  const pros = useProfessionals();
  const [from, setFrom] = useState(() => localDateKey(new Date(Date.now() - 30 * 86400e3)));
  const [to, setTo] = useState(() => localDateKey(new Date()));
  const [professionalId, setProfessionalId] = useState(can('patients.read_all') ? '' : me?.user.id ?? '');
  const [picking, setPicking] = useState(false);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [registering, setRegistering] = useState<PickedPatient | null>(null);
  const params = new URLSearchParams({ from: `${from}T00:00:00-03:00`, to: `${to}T23:59:59-03:00` });
  if (professionalId) params.set('professionalId', professionalId);
  const q = useQuery({ queryKey: ['sessions', 'recent', params.toString()], queryFn: () => api<SessionRow[]>(`/clinical/sessions?${params}`) });

  return (
    <>
      <PageHeader title="Atendimentos" description="Registre as sessões do dia e consulte os atendimentos realizados."
        actions={can('clinical.write') && <Button icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>Registrar atendimento</Button>} />
      <TodayAppointments />
      <Card className="mt-6">
        <CardHeader title="Atendimentos realizados" description={q.data ? `${q.data.filter((s) => !s.deleted).length} no período` : undefined} />
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Profissional">
            <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Todos</option>
              {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {q.isLoading && <LoadingState />}
        {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <EmptyState icon={<FileText className="size-6" />} title="Nenhum atendimento no período" />}
        <ul className="divide-y divide-slate-100">
          {q.data?.map((s) => (
            <li key={s.id}>
              <Link to={`/pacientes/${s.patient.id}?aba=evolucoes`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50/60">
                <Avatar name={s.patient.name} src={s.patient.photoUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    {s.patient.name} <span className="text-xs font-normal text-slate-500">Sessão {String(s.sessionNumber).padStart(2, '0')}</span>
                    <PainBadge value={s.content?.painScale} />
                    {s.deleted && <Badge tone="red">Excluída</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{formatDateTime(s.performedAt)} · {s.professional.name}{s.service && ` · ${s.service}`}</p>
                  {s.content && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{s.content.evolutionText}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Modal open={picking} onClose={() => { setPicking(false); setPatient(null); }} title="Registrar atendimento" description="Escolha o paciente atendido."
        footer={<><Button variant="outline" onClick={() => setPicking(false)}>Cancelar</Button><Button disabled={!patient} onClick={() => { setRegistering(patient); setPicking(false); setPatient(null); }}>Continuar</Button></>}>
        <PatientPicker value={patient} onChange={setPatient} autoFocus />
      </Modal>
      {registering && <SessionFormModal patient={registering} onClose={() => setRegistering(null)} />}
    </>
  );
}
