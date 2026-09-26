import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Switch } from '@/components/ui';
import { MoneyInput } from '@/components/editors';

interface Template { id: string; name: string; sessions: number; priceCents: number; validityDays: number | null; isActive: boolean }

export function PackageTemplates() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['finance', 'templates'], queryFn: () => api<Template[]>('/finance/package-templates') });
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const save = useMutation({
    mutationFn: (t: Partial<Template>) => {
      const body = { name: t.name, sessions: t.sessions, priceCents: t.priceCents, validityDays: t.validityDays || null, isActive: t.isActive };
      return t.id ? api(`/finance/package-templates/${t.id}`, { method: 'PATCH', body }) : api('/finance/package-templates', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance', 'templates'] }); setEditing(null); toast.success('Modelo de pacote salvo'); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader title="Pacotes de sessões" description="Modelos usados na venda de pacotes. Ex.: 10 sessões por R$ 1.000." actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ name: '', sessions: 10, priceCents: 0, isActive: true })}>Novo modelo</Button>} />
      {q.data?.length === 0 && <EmptyState icon={<Package className="size-6" />} title="Nenhum modelo de pacote" />}
      <ul className="divide-y divide-slate-100">
        {q.data?.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">{t.name}{!t.isActive && <Badge>Inativo</Badge>}</p>
              <p className="text-xs text-slate-500">{t.sessions} sessões · {formatMoney(t.priceCents)} ({formatMoney(Math.round(t.priceCents / t.sessions))}/sessão){t.validityDays && ` · validade ${t.validityDays} dias`}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>Editar</Button>
          </li>
        ))}
      </ul>
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm" title={editing.id ? 'Editar modelo' : 'Novo modelo de pacote'}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={(editing.name?.trim().length ?? 0) < 2 || !editing.sessions} loading={save.isPending} onClick={() => save.mutate(editing)}>Salvar</Button></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2"><Input autoFocus value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Pacote 10 sessões" /></Field>
            <Field label="Sessões"><Input type="number" min={1} value={editing.sessions ?? ''} onChange={(e) => setEditing({ ...editing, sessions: Number(e.target.value) })} /></Field>
            <Field label="Valor total"><MoneyInput cents={editing.priceCents ?? null} onChange={(c) => setEditing({ ...editing, priceCents: c ?? 0 })} /></Field>
            <Field label="Validade (dias)" hint="Opcional"><Input type="number" min={1} value={editing.validityDays ?? ''} onChange={(e) => setEditing({ ...editing, validityDays: e.target.value ? Number(e.target.value) : null })} /></Field>
            <div className="flex items-end justify-between pb-2"><span className="text-sm text-slate-700">Ativo</span><Switch checked={!!editing.isActive} onChange={(b) => setEditing({ ...editing, isActive: b })} label="Ativo" /></div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
