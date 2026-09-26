import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { PermissionGroup, RoleRow } from '@/lib/types';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, ErrorState, Field, Input, LoadingState, Modal } from '@/components/ui';

function RoleModal({ role, catalog, onClose }: { role: Partial<RoleRow>; catalog: PermissionGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(role.name ?? '');
  const [description, setDescription] = useState(role.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions ?? ['dashboard.view']));
  const locked = role.isLocked;

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, permissions: locked ? undefined : [...perms] };
      return role.id ? api(`/roles/${role.id}`, { method: 'PATCH', body }) : api('/roles', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Perfil salvo');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleModule = (g: PermissionGroup, on: boolean) =>
    setPerms((s) => {
      const n = new Set(s);
      g.permissions.forEach((p) => (on ? n.add(p.code) : n.delete(p.code)));
      return n;
    });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={role.id ? `Perfil: ${role.name}` : 'Novo perfil de acesso'}
      description={role.id && !role.isSystem ? 'Perfil personalizado' : role.isSystem ? 'Perfil padrão do sistema' : 'Crie perfis como "Estagiário" ou "Financeiro".'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2}>
            Salvar perfil
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do perfil" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Descrição">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {locked && (
          <Alert tone="blue" icon={<Lock className="size-4" />}>
            O perfil Administrador sempre tem todas as permissões, para que a clínica nunca perca o acesso de gestão.
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {catalog.map((g) => {
            const all = g.permissions.every((p) => perms.has(p.code));
            return (
              <div key={g.module} className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">{g.module}</h3>
                  {!locked && (
                    <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => toggleModule(g, !all)}>
                      {all ? 'Desmarcar todas' : 'Marcar todas'}
                    </button>
                  )}
                </div>
                <div className="space-y-2.5 px-4 py-3">
                  {g.permissions.map((p) => (
                    <Checkbox
                      key={p.code}
                      disabled={locked}
                      checked={locked || perms.has(p.code)}
                      onChange={(on) =>
                        setPerms((s) => {
                          const n = new Set(s);
                          if (on) n.add(p.code);
                          else n.delete(p.code);
                          return n;
                        })
                      }
                      label={p.description}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

export function RolesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') });
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: () => api<PermissionGroup[]>('/roles/permissions') });
  const [editing, setEditing] = useState<Partial<RoleRow> | null>(null);
  const [removing, setRemoving] = useState<RoleRow | null>(null);
  const canManage = can('roles.manage');
  const total = catalog.data?.reduce((n, g) => n + g.permissions.length, 0) ?? 0;

  const remove = useMutation({
    mutationFn: (r: RoleRow) => api(`/roles/${r.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setRemoving(null);
      toast.success('Perfil excluído');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader
        title="Perfis e permissões"
        description="Cada usuário tem um perfil. Exceções individuais são feitas na tela de Usuários."
        actions={
          canManage && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({})} disabled={!catalog.data}>
              Novo perfil
            </Button>
          )
        }
      />
      {(roles.isLoading || catalog.isLoading) && <LoadingState rows={3} />}
      {roles.isError && <ErrorState message={roles.error.message} onRetry={() => roles.refetch()} />}
      <ul className="divide-y divide-slate-100">
        {roles.data?.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                {r.name}
                {r.isSystem ? <Badge>Padrão</Badge> : <Badge tone="violet">Personalizado</Badge>}
                {!r.permissions.includes('clinical.read') && <Badge tone="amber">Sem acesso clínico</Badge>}
              </p>
              <p className="text-sm text-slate-500">{r.description}</p>
              <p className="mt-1 text-xs text-slate-400">
                {r.permissions.length} de {total} permissões · {r.activeUsers} usuário(s) ativo(s)
              </p>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(r)} disabled={!catalog.data}>
                {canManage && !r.isLocked ? 'Editar' : 'Ver'}
              </Button>
              {canManage && !r.isSystem && (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(r)} aria-label="Excluir perfil">
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && catalog.data && <RoleModal role={editing} catalog={catalog.data} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        title={`Excluir o perfil "${removing?.name}"?`}
        description="Só é possível excluir perfis sem usuários vinculados."
        confirmLabel="Excluir"
      />
    </Card>
  );
}
