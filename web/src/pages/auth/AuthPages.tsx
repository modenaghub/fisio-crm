import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Building2, Check, CircleAlert, MailCheck } from 'lucide-react';
import clsx from 'clsx';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Alert, Button, Checkbox, Field, Input, PasswordInput } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';

const email = z.string().trim().min(1, 'Informe o e-mail').email('E-mail inválido');
const password = z
  .string()
  .min(8, 'Mínimo de 8 caracteres')
  .regex(/[A-Za-z]/, 'Inclua ao menos uma letra')
  .regex(/\d/, 'Inclua ao menos um número');

function PasswordChecklist({ value }: { value: string }) {
  const rules = [
    { ok: value.length >= 8, label: '8 caracteres ou mais' },
    { ok: /[A-Za-z]/.test(value), label: 'Uma letra' },
    { ok: /\d/.test(value), label: 'Um número' },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {rules.map((r) => (
        <li key={r.label} className={clsx('flex items-center gap-1', r.ok ? 'text-emerald-600' : 'text-slate-400')}>
          <Check className="size-3.5" /> {r.label}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Login ─────────────────────────

const loginSchema = z.object({ email, password: z.string().min(1, 'Informe a senha') });

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<{ message: string; locked?: boolean } | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  async function submit(values: z.infer<typeof loginSchema>, organizationId?: string) {
    setError(null);
    try {
      const r = await login(values.email, values.password, organizationId);
      if (!r.ok) return setOrgs(r.organizations);
      navigate('/', { replace: true });
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, locked: err.status === 423 });
    }
  }

  if (orgs) {
    return (
      <AuthLayout title="Escolha a clínica" subtitle="Seu e-mail tem acesso a mais de uma clínica.">
        <div className="space-y-2">
          {orgs.map((o) => (
            <button
              key={o.id}
              onClick={form.handleSubmit((v) => submit(v, o.id))}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 hover:border-brand-300 hover:bg-brand-50"
            >
              <Building2 className="size-5 text-brand-700" /> {o.name}
            </button>
          ))}
        </div>
        <Button variant="ghost" className="mt-6" icon={<ArrowLeft className="size-4" />} onClick={() => setOrgs(null)}>
          Voltar
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse o sistema da sua clínica."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="font-medium text-brand-700 hover:underline">
            Criar conta da clínica
          </Link>
        </>
      }
    >
      {import.meta.env.VITE_DEMO && (
        <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
          <p className="font-semibold">Acesse a clínica de demonstração</p>
          <p className="mt-0.5 text-brand-800/80">Senha de todos: <code className="font-mono">Demo@2026</code></p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ['admin@demo.fisiocrm.local', 'Administrador'],
              ['fisio@demo.fisiocrm.local', 'Fisioterapeuta'],
              ['recepcao@demo.fisiocrm.local', 'Recepção'],
            ].map(([email, label]) => (
              <button
                key={email}
                type="button"
                onClick={() => {
                  form.setValue('email', email);
                  form.setValue('password', 'Demo@2026');
                }}
                className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-100"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-brand-800/80">Ou crie uma clínica nova para passar pelo primeiro acesso.</p>
        </div>
      )}
      <form onSubmit={form.handleSubmit((v) => submit(v))} className="space-y-5" noValidate>
        {error && (
          <Alert tone="red" icon={<CircleAlert className="size-4" />}>
            {error.message}
            {error.locked && (
              <>
                {' '}
                <Link to="/esqueci-senha" className="font-semibold underline">
                  Redefinir senha
                </Link>
              </>
            )}
          </Alert>
        )}
        <Field label="E-mail" error={form.formState.errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" autoFocus invalid={!!form.formState.errors.email} {...form.register('email')} />
        </Field>
        <Field
          label="Senha"
          error={form.formState.errors.password?.message}
          htmlFor="password"
        >
          <PasswordInput id="password" autoComplete="current-password" invalid={!!form.formState.errors.password} {...form.register('password')} />
        </Field>
        <div className="flex justify-end">
          <Link to="/esqueci-senha" className="text-sm font-medium text-brand-700 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}

// ───────────────────────── Cadastro ─────────────────────────

const registerSchema = z.object({
  organizationName: z.string().trim().min(2, 'Informe o nome da clínica ou consultório'),
  name: z.string().trim().min(3, 'Informe seu nome completo'),
  email,
  password,
  acceptTerms: z.literal(true, { message: 'É necessário aceitar para continuar' }),
});

export function RegisterPage() {
  const { register: doRegister } = useAuth();
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { acceptTerms: false as unknown as true, password: '' },
  });
  const pwd = form.watch('password') ?? '';
  const accepted = form.watch('acceptTerms');
  const { errors } = form.formState;

  async function submit(v: z.infer<typeof registerSchema>) {
    try {
      await doRegister(v);
      navigate('/primeiro-acesso', { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AuthLayout
      title="Criar conta da clínica"
      subtitle="Leva menos de um minuto. Depois, configuramos sua agenda e seus valores."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/entrar" className="font-medium text-brand-700 hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <Field label="Nome da clínica ou consultório" required error={errors.organizationName?.message} htmlFor="org">
          <Input id="org" autoFocus invalid={!!errors.organizationName} {...form.register('organizationName')} />
        </Field>
        <Field label="Seu nome completo" required error={errors.name?.message} htmlFor="name">
          <Input id="name" autoComplete="name" invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <Field label="E-mail" required error={errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <Field label="Senha" required error={errors.password?.message} hint={<PasswordChecklist value={pwd} />} htmlFor="password">
          <PasswordInput id="password" autoComplete="new-password" invalid={!!errors.password} {...form.register('password')} />
        </Field>
        <div className="pt-1">
          <Checkbox
            checked={!!accepted}
            onChange={(v) => form.setValue('acceptTerms', v as true, { shouldValidate: form.formState.isSubmitted })}
            label="Li e aceito os termos de uso e a política de privacidade"
            description="Incluindo o tratamento de dados de saúde dos pacientes conforme a LGPD."
          />
          {errors.acceptTerms && <p className="mt-1.5 text-xs font-medium text-red-600">{errors.acceptTerms.message}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}

// ───────────────────────── Esqueci a senha ─────────────────────────

function useSystemInfo() {
  return useQuery({
    queryKey: ['system-info'],
    queryFn: () => api<{ devMailbox: boolean }>('/system/info', { auth: false }),
    staleTime: Infinity,
  });
}

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const info = useSystemInfo();
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });

  async function submit(v: { email: string }) {
    try {
      await api('/auth/forgot-password', { method: 'POST', body: v, auth: false });
      setSentTo(v.email);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Verifique seu e-mail" footer={<Link to="/entrar" className="font-medium text-brand-700 hover:underline">Voltar para o login</Link>}>
        <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-6 py-8 text-center">
          <MailCheck className="size-10 text-brand-700" />
          <p className="mt-4 text-sm text-slate-600">
            Se <strong className="text-slate-900">{sentTo}</strong> estiver cadastrado, você receberá um link para criar uma nova senha. O link vale por 60 minutos.
          </p>
        </div>
        {info.data?.devMailbox && (
          <Alert tone="blue" title="Modo demonstração">
            Nenhum e-mail é enviado de verdade. Veja o link na{' '}
            <Link to="/dev/emails" className="font-semibold underline">
              caixa de e-mails de teste
            </Link>
            .
          </Alert>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Redefinir senha"
      subtitle="Informe o e-mail de acesso. Enviaremos um link para criar uma nova senha."
      footer={<Link to="/entrar" className="font-medium text-brand-700 hover:underline">Voltar para o login</Link>}
    >
      <form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>
        <Field label="E-mail" error={form.formState.errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" autoFocus invalid={!!form.formState.errors.email} {...form.register('email')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Enviar link
        </Button>
      </form>
    </AuthLayout>
  );
}

// ───────────────────────── Nova senha (reset ou convite) ─────────────────────────

const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não conferem' });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const isInvite = params.get('convite') === '1';
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });
  const pwd = form.watch('password');

  async function submit(v: z.infer<typeof resetSchema>) {
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password }, auth: false });
      toast.success(isInvite ? 'Senha criada! Agora é só entrar.' : 'Senha redefinida. Entre com a nova senha.');
      navigate('/entrar', { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Link inválido" footer={<Link to="/esqueci-senha" className="font-medium text-brand-700 hover:underline">Solicitar novo link</Link>}>
        <Alert tone="red">Este link está incompleto. Abra novamente o link recebido por e-mail.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={isInvite ? 'Bem-vindo(a)! Crie sua senha' : 'Criar nova senha'}
      subtitle={isInvite ? 'Defina a senha que você usará para acessar o sistema da clínica.' : 'Ao salvar, todas as sessões abertas serão encerradas.'}
    >
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <Field label="Nova senha" error={form.formState.errors.password?.message} hint={<PasswordChecklist value={pwd} />} htmlFor="p1">
          <PasswordInput id="p1" autoComplete="new-password" autoFocus invalid={!!form.formState.errors.password} {...form.register('password')} />
        </Field>
        <Field label="Confirme a senha" error={form.formState.errors.confirm?.message} htmlFor="p2">
          <PasswordInput id="p2" autoComplete="new-password" invalid={!!form.formState.errors.confirm} {...form.register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Salvar senha
        </Button>
      </form>
    </AuthLayout>
  );
}

// ───────────────────────── Caixa de e-mails (somente demonstração) ─────────────────────────

export function DevMailboxPage() {
  const q = useQuery({
    queryKey: ['dev-mailbox'],
    queryFn: () => api<{ id: string; to: string; subject: string; text: string; sentAt: string }[]>('/dev/mailbox', { auth: false }),
    refetchInterval: 3000,
  });
  const linkify = (text: string) =>
    text.split(/(https?:\/\/\S+)/g).map((part, i) =>
      part.startsWith('http') ? (
        <Link key={i} to={part.replace(/^https?:\/\/[^/]+/, '')} className="break-all font-medium text-brand-700 underline">
          {part}
        </Link>
      ) : (
        part
      ),
    );
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Alert tone="blue" title="Caixa de e-mails de teste">
        Disponível apenas em desenvolvimento, enquanto nenhum provedor de e-mail real estiver configurado. Mostra os convites e links de senha que seriam enviados.
      </Alert>
      <div className="mt-6 space-y-3">
        {q.data?.length === 0 && <p className="text-center text-sm text-slate-500">Nenhum e-mail enviado ainda.</p>}
        {q.isError && <p className="text-center text-sm text-slate-500">Caixa indisponível (produção ou e-mail real configurado).</p>}
        {q.data?.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
              <span>Para: {m.to}</span>
              <span>{new Date(m.sentAt).toLocaleString('pt-BR')}</span>
            </div>
            <p className="mt-1 font-semibold text-slate-900">{m.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-slate-600">{linkify(m.text)}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-sm">
        <Link to="/entrar" className="font-medium text-brand-700 hover:underline">
          Ir para o login
        </Link>
      </p>
    </div>
  );
}
