import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Laptop, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeUserAgent, formatRelative, maskPhone } from '@/lib/format';
import { Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, Field, Input, LoadingState, PasswordInput } from '@/components/ui';

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  isCurrent: boolean;
}

const pwdSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: z.string().min(8, 'Mínimo de 8 caracteres').regex(/[A-Za-z]/, 'Inclua uma letra').regex(/\d/, 'Inclua um número'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'As senhas não conferem' });

export function AccountPage() {
  const { me, reload } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(me?.user.name ?? '');
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [confirmOthers, setConfirmOthers] = useState(false);

  const profile = useMutation({
    mutationFn: () => api('/auth/me', { method: 'PATCH', body: { name, phone } }),
    onSuccess: async () => {
      await reload();
      toast.success('Perfil atualizado');
    },
    onError: (e) => toast.error(e.message),
  });

  const pwd = useForm<z.infer<typeof pwdSchema>>({ resolver: zodResolver(pwdSchema) });
  const changePwd = async (v: z.infer<typeof pwdSchema>) => {
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      pwd.reset({ currentPassword: '', newPassword: '', confirm: '' });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Senha alterada. As outras sessões foram encerradas.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionRow[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Sessão encerrada');
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' }),
    onSuccess: () => {
      setConfirmOthers(false);
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Outras sessões encerradas');
    },
    onError: (e) => toast.error(e.message),
  });

  if (!me) return null;
  const others = sessions.data?.filter((s) => !s.isCurrent).length ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Perfil" description={`${me.user.email} · ${me.user.role.name}`} />
        <form
          className="grid gap-5 px-5 py-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 3) profile.mutate();
          }}
        >
          <Field label="Nome completo" htmlFor="nm" error={name.trim().length < 3 ? 'Informe o nome completo' : undefined}>
            <Input id="nm" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Telefone" htmlFor="tl">
            <Input id="tl" inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={profile.isPending}>
              Salvar perfil
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Alterar senha" description="Ao trocar a senha, as sessões abertas em outros dispositivos são encerradas." />
        <form onSubmit={pwd.handleSubmit(changePwd)} className="grid gap-5 px-5 py-5 sm:grid-cols-3" noValidate>
          <Field label="Senha atual" error={pwd.formState.errors.currentPassword?.message}>
            <PasswordInput autoComplete="current-password" {...pwd.register('currentPassword')} />
          </Field>
          <Field label="Nova senha" error={pwd.formState.errors.newPassword?.message}>
            <PasswordInput autoComplete="new-password" {...pwd.register('newPassword')} />
          </Field>
          <Field label="Confirme a nova senha" error={pwd.formState.errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...pwd.register('confirm')} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" loading={pwd.formState.isSubmitting}>
              Alterar senha
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Sessões ativas"
          description="Dispositivos conectados à sua conta."
          actions={
            others > 0 && (
              <Button variant="outline" size="sm" icon={<LogOut className="size-4" />} onClick={() => setConfirmOthers(true)}>
                Encerrar as outras ({others})
              </Button>
            )
          }
        />
        {sessions.isLoading && <LoadingState rows={2} />}
        {sessions.isError && <ErrorState message={sessions.error.message} onRetry={() => sessions.refetch()} />}
        <ul className="divide-y divide-slate-100">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-4 px-5 py-3.5">
              <Laptop className="size-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {describeUserAgent(s.userAgent)} {s.isCurrent && <Badge tone="green">Este dispositivo</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  IP {s.ipAddress ?? '—'} · ativo {formatRelative(s.lastUsedAt)}
                </p>
              </div>
              {!s.isCurrent && (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id}>
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirmOthers}
        onClose={() => setConfirmOthers(false)}
        onConfirm={() => revokeOthers.mutate()}
        loading={revokeOthers.isPending}
        title="Encerrar as outras sessões?"
        description="Todos os outros dispositivos precisarão entrar novamente. Esta sessão continua ativa."
        confirmLabel="Encerrar sessões"
      />
    </div>
  );
}
