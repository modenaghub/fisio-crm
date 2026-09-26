import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { PayModal, PayStatusBadge, ReceivableModal, SellPackageModal, type PackageRow, type Receivable } from '@/components/finance-forms';
import { PackagesList, StatTile } from '@/pages/finance/FinancePage';
import type { PatientDetail } from '../PatientPage';

export default function FinanceTab({ patient }: { patient: PatientDetail }) {
  const { can } = useAuth();
  const packages = useQuery({ queryKey: ['patient-packages', patient.id], queryFn: () => api<PackageRow[]>(`/patients/${patient.id}/packages`) });
  const rec = useQuery({ queryKey: ['finance', 'receivables', 'patient', patient.id], queryFn: () => api<{ totals: { amountCents: number; paidCents: number; openCents: number }; items: Receivable[] }>(`/finance/receivables?patientId=${patient.id}&pageSize=200`) });
  const [selling, setSelling] = useState(false);
  const [charging, setCharging] = useState(false);
  const [paying, setPaying] = useState<Receivable | null>(null);
  const picked = { id: patient.id, name: patient.name, code: patient.code, photoUrl: patient.photoUrl };
  const items = (rec.data?.items ?? []).filter((r) => r.status !== 'CANCELLED');
  const overdue = items.filter((r) => r.status === 'OVERDUE').reduce((n, r) => n + r.openCents, 0);
  return (
    <div className="space-y-4">
      {rec.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Total cobrado" value={formatMoney(items.reduce((n, r) => n + r.amountCents, 0))} />
          <StatTile label="Recebido" value={formatMoney(items.reduce((n, r) => n + r.paidCents, 0))} />
          <StatTile label="Em aberto" value={formatMoney(items.reduce((n, r) => n + r.openCents, 0))} tone={overdue > 0 ? 'bad' : undefined} hint={overdue > 0 ? `${formatMoney(overdue)} em atraso` : undefined} />
        </div>
      )}
      <Card>
        <CardHeader title="Pacotes" actions={can('finance.write') && <Button size="sm" icon={<Package className="size-4" />} onClick={() => setSelling(true)}>Vender pacote</Button>} />
        {packages.isLoading && <LoadingState rows={1} />}
        {packages.data?.length === 0 && <EmptyState title="Nenhum pacote" description="Venda um pacote para que as sessões sejam descontadas automaticamente." />}
        {!!packages.data?.length && <PackagesList rows={packages.data} />}
      </Card>
      <Card>
        <CardHeader title="Cobranças" actions={can('finance.write') && <Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={() => setCharging(true)}>Nova cobrança</Button>} />
        {rec.isLoading && <LoadingState rows={2} />}
        {rec.isError && <ErrorState message={rec.error.message} onRetry={() => rec.refetch()} />}
        {rec.data?.items.length === 0 && <EmptyState title="Nenhuma cobrança" />}
        <ul className="divide-y divide-slate-100">
          {rec.data?.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-900">{r.description}</p>
                <p className="text-xs text-slate-500">Vence {formatDate(r.dueDate)}{r.paidAt && ` · pago em ${formatDate(r.paidAt)}`}{r.method && ` · ${PAYMENT_METHOD_LABELS[r.method]}`}</p>
              </div>
              <span className="text-sm font-medium tabular">{formatMoney(r.amountCents)}</span>
              <PayStatusBadge status={r.status} />
              {can('finance.write') && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setPaying(r)}>Receber</Button>}
            </li>
          ))}
        </ul>
      </Card>
      {selling && <SellPackageModal patient={picked} onClose={() => setSelling(false)} />}
      {charging && <ReceivableModal patient={picked} onClose={() => setCharging(false)} />}
      {paying && <PayModal item={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}
