import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { KeyRound, Lock, Mail, MoreHorizontal, Pencil, Plus, Search, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative, maskPhone } from '@/lib/format';
import type { PermissionGroup, RoleRow, UserRow } from '@/lib/types';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Tabs,
} from '@/components/ui';

interface UnitRow {
  id: string;
  name: string;
  isActive: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ───────────────────────── Formulário de usuário ─────────────────────────

interface Draft {
  id?: string;
  name: string;
  email: string;
  phone: string;
  roleId: string;
  unitIds: string[];
  isProfessional: boolean;
  crefito: string;
  specialties: string;
  calendarColor: string;
  passwordMode: 'invite' | 'set';
  password: string;
}

function emptyDraft(roles: RoleRow[], units: UnitRow[]): Draft {
  return {
    name: '',
    email: '',
    phone: '',
    roleId: roles.find((r) => r.key === 'PHYSIO')?.id ?? roles[0]?.id ?? '',
    unitIds: units.slice(0, 1).map((u) => u.id),
    isProfessional: true,
    crefito: '',
    specialties: '',
    calendarColor: '#0f766e',
    passwordMode: 'invite',
    password: '',
  };
}

function validate(d: Draft) {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (d.name.trim().length < 3) e.name = 'Informe o nome completo';
  if (!EMAIL_RE.test(d.email.trim())) e.email = 'E-mail inválido';
  if (!d.roleId) e.roleId = 'Selecione o perfil';
  if (!d.unitIds.length) e.unitIds = 'Selecione ao menos uma unidade';
  if (!d.id && d.passwordMode === 'set' && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(d.password)) e.password = 'Mínimo de 8 caracteres, com letras e números';
  return e;
}

function UserFormModal({
  draft,
  onClose,
  roles,
  units,
  isSelf,
}: {
  draft: Draft;
  onClose: () => void;
  roles: RoleRow[];
  units: UnitRow[];
  isSelf: boolean;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(draft);
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const errors = validate(d);
  const role = roles.find((r) => r.id === d.roleId);

  const save = useMutation({
    mutationFn: async (x: Draft) => {
      const common = {
        name: x.name,
        email: x.email,
        phone: x.phone || undefined,
        roleId: x.roleId,
        unitIds: x.unitIds,
        isProfessional: x.isProfessional,
        crefito: x.isProfessional ? x.crefito || undefined : undefined,
        specialties: x.isProfessional ? x.specialties.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      };
      if (x.id) {
        return api<UserRow>(`/users/${x.id}`, {
          method: 'PATCH',
          body: { ...common, roleId: isSelf ? undefined : x.roleId, calendarColor: x.isProfessional ? x.calendarColor : undefined },
        });
      }
      return api<UserRow & { invited: boolean }>('/users', { method: 'POST', body: { ...common, password: x.passwordMode === 'set' ? x.password : undefined } });
    },
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success(d.id ? 'Usuário atualizado' : 'invited' in u && u.invited ? `Convite enviado para ${u.email}` : 'Usuário criado');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const show = (k: keyof Draft) => (submitted ? errors[k] : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={d.id ? 'Editar usuário' : 'Novo usuário'}
      description={d.id ? d.email : 'O usuário acessa o sistema com o perfil escolhido.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setSubmitted(true);
              if (Object.keys(errors).length === 0) save.mutate(d);
            }}
          >
            {d.id ? 'Salvar alterações' : d.passwordMode === 'invite' ? 'Criar e enviar convite' : 'Criar usuário'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo" required error={show('name')} className="sm:col-span-2">
            <Input autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} invalid={!!show('name')} />
          </Field>
          <Field label="E-mail de acesso" required error={show('email')}>
            <Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} invalid={!!show('email')} />
          </Field>
          <Field label="Telefone">
            <Input inputMode="tel" value={d.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} />
          </Field>
          <Field
            label="Perfil de acesso"
            required
            error={show('roleId')}
            hint={isSelf ? 'Você não pode alterar o seu próprio perfil.' : role?.description ?? undefined}
          >
            <Select value={d.roleId} disabled={isSelf} onChange={(e) => set('roleId', e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unidades" required error={show('unitIds')}>
            <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2.5">
              {units.map((u) => (
                <Checkbox
                  key={u.id}
                  label={u.name}
                  checked={d.unitIds.includes(u.id)}
                  onChange={(on) => set('unitIds', on ? [...d.unitIds, u.id] : d.unitIds.filter((x) => x !== u.id))}
                />
              ))}
            </div>
          </Field>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <Checkbox
            checked={d.isProfessional}
            onChange={(v) => set('isProfessional', v)}
            label="Realiza atendimentos"
            description="Aparece na agenda e pode ser responsável por pacientes."
          />
          {d.isProfessional && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="CREFITO">
                <Input value={d.crefito} onChange={(e) => set('crefito', e.target.value)} />
              </Field>
              <Field label="Especialidades" hint="Separe por vírgula.">
                <Input value={d.specialties} onChange={(e) => set('specialties', e.target.value)} />
              </Field>
              {d.id && (
                <Field label="Cor na agenda">
                  <div className="flex items-center gap-2">
                    <input type="color" value={d.calendarColor} onChange={(e) => set('calendarColor', e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" aria-label="Cor na agenda" />
                    <span className="font-mono text-xs text-slate-500">{d.calendarColor}</span>
                  </div>
                </Field>
              )}
            </div>
          )}
        </div>

        {!d.id && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-800">Senha de acesso</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['invite', 'Enviar convite por e-mail', 'A pessoa define a própria senha (link válido por 72 h).'],
                  ['set', 'Definir senha agora', 'Você informa a senha pessoalmente.'],
                ] as const
              ).map(([mode, title, desc]) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => set('passwordMode', mode)}
                  className={clsx(
                    'rounded-xl border px-4 py-3 text-left transition-colors',
                    d.passwordMode === mode ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <p className="text-sm font-medium text-slate-900">{title}</p>
                  <p className="text-xs text-slate-500">{desc}</p>
                </button>
              ))}
            </div>
            {d.passwordMode === 'set' && (
              <Field label="Senha inicial" error={show('password')}>
                <Input type="text" autoComplete="off" value={d.password} onChange={(e) => set('password', e.target.value)} invalid={!!show('password')} />
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Exceções de permissão ─────────────────────────

function PermissionsModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: () => api<PermissionGroup[]>('/roles/permissions') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') });
  const roleDefaults = new Set(roles.data?.find((r) => r.id === user.role.id)?.permissions ?? []);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(Object.fromEntries(user.overrides.map((o) => [o.permissionCode, o.granted])));

  const save = useMutation({
    mutationFn: () =>
      api(`/users/${user.id}/permissions`, {
        method: 'PUT',
        body: { overrides: Object.entries(overrides).map(([permissionCode, granted]) => ({ permissionCode, granted })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Permissões atualizadas — valem a partir da próxima ação do usuário');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Permissões de ${user.name}`}
      description={`Perfil ${user.role.name}. Ajuste apenas as exceções — o restante segue o perfil.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Salvar exceções
          </Button>
        </>
      }
    >
      {(catalog.isLoading || roles.isLoading) && <LoadingState />}
      {catalog.data && (
        <div className="space-y-6">
          <Alert tone="amber" icon={<ShieldAlert className="size-4" />}>
            Permissões de <strong>Prontuário</strong> dão acesso a dados de saúde. Conceda somente a quem precisa para o atendimento — todo acesso fica registrado na auditoria.
          </Alert>
          {catalog.data.map((g) => (
            <div key={g.module}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.module}</h3>
              <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {g.permissions.map((p) => {
                  const fromRole = roleDefaults.has(p.code);
                  const state = p.code in overrides ? (overrides[p.code] ? 'grant' : 'deny') : 'default';
                  const effective = state === 'default' ? fromRole : state === 'grant';
                  return (
                    <div key={p.code} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">{p.description}</p>
                        <p className="font-mono text-[11px] text-slate-400">{p.code}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={effective ? 'green' : 'slate'}>{effective ? 'Permitido' : 'Sem acesso'}</Badge>
                        <Select
                          aria-label={`Exceção para ${p.description}`}
                          className={clsx('h-9 w-48 text-xs', state !== 'default' && 'border-brand-600 bg-brand-50')}
                          value={state}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOverrides((o) => {
                              const n = { ...o };
                              if (v === 'default') delete n[p.code];
                              else n[p.code] = v === 'grant';
                              return n;
                            });
                          }}
                        >
                          <option value="default">Padrão do perfil ({fromRole ? 'sim' : 'não'})</option>
                          <option value="grant">Conceder</option>
                          <option value="deny">Negar</option>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────── Menu de ações da linha ─────────────────────────

function RowMenu({ items }: { items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Ações">
        <MoreHorizontal className="size-5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items
            .filter((i) => !i.hidden)
            .map((i) => (
              <button
                key={i.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  i.onClick();
                }}
                className={clsx('flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm', i.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50')}
              >
                {i.icon} {i.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Página ─────────────────────────

export function UsersPage() {
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [perms, setPerms] = useState<UserRow | null>(null);
  const [toggle, setToggle] = useState<UserRow | null>(null);

  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => api<UserRow[]>('/users?status=all') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') });
  const units = useQuery({ queryKey: ['units'], queryFn: () => api<UnitRow[]>('/settings/units') });
  const activeUnits = (units.data ?? []).filter((u) => u.isActive);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (users.data ?? []).filter(
      (u) => (status === 'active' ? u.isActive : !u.isActive) && (!s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)),
    );
  }, [users.data, status, search]);

  const setActive = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}/active`, { method: 'PUT', body: { isActive: !u.isActive } }),
    onSuccess: (_, u) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setToggle(null);
      toast.success(u.isActive ? `${u.name} foi desativado(a) e desconectado(a)` : `${u.name} foi reativado(a)`);
    },
    onError: (e) => toast.error(e.message),
  });
  const sendLink = useMutation({
    mutationFn: (u: UserRow) => api<{ kind: string }>(`/users/${u.id}/send-access-link`, { method: 'POST' }),
    onSuccess: (r, u) => toast.success(r.kind === 'invite' ? `Convite reenviado para ${u.email}` : `Link de redefinição enviado para ${u.email}`),
    onError: (e) => toast.error(e.message),
  });
  const unlock = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}/unlock`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Acesso desbloqueado');
    },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (u: UserRow) =>
    setEditing({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone ?? '',
      roleId: u.role.id,
      unitIds: u.units.map((x) => x.id),
      isProfessional: !!u.professional,
      crefito: u.professional?.crefito ?? '',
      specialties: u.professional?.specialties.join(', ') ?? '',
      calendarColor: u.professional?.calendarColor ?? '#0f766e',
      passwordMode: 'invite',
      password: '',
    });

  const counts = { active: users.data?.filter((u) => u.isActive).length ?? 0, inactive: users.data?.filter((u) => !u.isActive).length ?? 0 };
  const ready = roles.data && units.data;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Usuários</h2>
          <p className="text-sm text-slate-500">Equipe com acesso ao sistema.</p>
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} disabled={!ready} onClick={() => ready && setEditing(emptyDraft(roles.data!, activeUnits))}>
          Novo usuário
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-3 px-5 sm:flex-row sm:items-end sm:justify-between">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'active', label: 'Ativos', count: counts.active },
            { value: 'inactive', label: 'Inativos', count: counts.inactive },
          ]}
        />
        <div className="pb-2 sm:w-64">
          <Input leading={<Search className="size-4" />} placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {users.isLoading && <LoadingState />}
      {users.isError && <ErrorState message={users.error.message} onRetry={() => users.refetch()} />}
      {users.data && filtered.length === 0 && (
        <EmptyState
          title={search ? 'Nenhum usuário encontrado' : status === 'active' ? 'Nenhum usuário ativo' : 'Nenhum usuário inativo'}
          description={search ? 'Tente outro nome ou e-mail.' : undefined}
        />
      )}

      {filtered.length > 0 && (
        <div className="pb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">Usuário</th>
                <th className="hidden px-3 py-2.5 md:table-cell">Perfil</th>
                <th className="hidden whitespace-nowrap px-3 py-2.5 lg:table-cell">Último acesso</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => {
                const isSelf = u.id === me?.user.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50/50">
                    <td className="w-full max-w-0 px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size="sm" />
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                            {u.name}
                            {isSelf && <Badge tone="brand">Você</Badge>}
                            {u.isLocked && (
                              <Badge tone="red">
                                <Lock className="size-3" /> Bloqueado
                              </Badge>
                            )}
                            {u.overrides.length > 0 && <Badge tone="violet">{u.overrides.length} exceç{u.overrides.length > 1 ? 'ões' : 'ão'}</Badge>}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {u.email}
                            {u.professional?.crefito && <span className="hidden sm:inline"> · CREFITO {u.professional.crefito}</span>}
                          </p>
                          <p className="text-xs text-slate-500 md:hidden">{u.role.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <Badge tone={u.role.key === 'ADMIN' ? 'brand' : u.role.key === 'PHYSIO' ? 'blue' : u.role.key === 'RECEPTION' ? 'amber' : 'slate'}>{u.role.name}</Badge>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-slate-500 lg:table-cell">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : <span className="text-slate-400">Nunca acessou</span>}</td>
                    <td className="px-3 py-3 text-right">
                      <RowMenu
                        items={[
                          { label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => openEdit(u) },
                          { label: 'Exceções de permissão', icon: <KeyRound className="size-4" />, onClick: () => setPerms(u), hidden: isSelf || !can('roles.manage') },
                          { label: u.lastLoginAt ? 'Enviar link de nova senha' : 'Reenviar convite', icon: <Mail className="size-4" />, onClick: () => sendLink.mutate(u), hidden: !u.isActive },
                          { label: 'Desbloquear acesso', icon: <Lock className="size-4" />, onClick: () => unlock.mutate(u), hidden: !u.isLocked },
                          {
                            label: u.isActive ? 'Desativar' : 'Reativar',
                            icon: u.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />,
                            onClick: () => setToggle(u),
                            danger: u.isActive,
                            hidden: isSelf,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && ready && (
        <UserFormModal key={editing.id ?? 'new'} draft={editing} onClose={() => setEditing(null)} roles={roles.data!} units={activeUnits} isSelf={editing.id === me?.user.id} />
      )}
      {perms && <PermissionsModal user={perms} onClose={() => setPerms(null)} />}
      <ConfirmDialog
        open={!!toggle}
        onClose={() => setToggle(null)}
        onConfirm={() => toggle && setActive.mutate(toggle)}
        loading={setActive.isPending}
        tone={toggle?.isActive ? 'danger' : 'primary'}
        title={toggle?.isActive ? `Desativar ${toggle?.name}?` : `Reativar ${toggle?.name}?`}
        description={
          toggle?.isActive
            ? 'O acesso é cortado imediatamente, inclusive em sessões abertas. Todo o histórico registrado por este usuário é mantido.'
            : 'O usuário volta a acessar com a senha atual.'
        }
        confirmLabel={toggle?.isActive ? 'Desativar' : 'Reativar'}
      />
    </Card>
  );
}
