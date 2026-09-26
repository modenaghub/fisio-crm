import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { NAV } from '@/lib/nav';
import type { UserRow } from '@/lib/types';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export function HomePage() {
  const { me, can } = useAuth();
  const users = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => api<UserRow[]>('/users?status=active'),
    enabled: can('users.manage'),
  });
  if (!me) return null;
  const firstName = me.user.name.split(' ')[0];
  const modules = NAV.filter((n) => n.phase).sort((a, b) => a.phase! - b.phase!);

  const checklist = [
    { done: me.organization.onboardingCompleted, label: 'Configuração inicial da clínica', to: '/primeiro-acesso', cta: 'Revisar' },
    ...(can('users.manage')
      ? [{ done: (users.data?.length ?? 0) > 1, label: 'Cadastrar a equipe (fisioterapeutas e recepção)', to: '/configuracoes/usuarios', cta: 'Cadastrar' }]
      : []),
    { done: false, label: 'Cadastrar os primeiros pacientes', note: 'Fase 3' },
    { done: false, label: 'Montar a agenda da semana', note: 'Fase 5' },
    { done: false, label: 'Conectar o WhatsApp oficial', note: 'Fase 7' },
  ];

  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName}`} description={`Como está sua clínica hoje? · ${me.organization.clinicName}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Primeiros passos" description="O que já está pronto e o que vem a seguir." />
          <ul className="divide-y divide-slate-100">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-3 px-5 py-3.5">
                {c.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <Circle className="size-5 shrink-0 text-slate-300" />}
                <span className={clsx('flex-1 text-sm', c.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800')}>{c.label}</span>
                {'note' in c && c.note ? (
                  <Badge>{c.note}</Badge>
                ) : (
                  'to' in c &&
                  !c.done && (
                    <Link to={c.to!} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                      {c.cta} <ArrowRight className="size-3.5" />
                    </Link>
                  )
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Sua conta" />
          <div className="space-y-4 px-5 py-4 text-sm">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-brand-700" />
              <div>
                <p className="font-medium text-slate-800">{me.user.role.name}</p>
                <p className="text-slate-500">{me.permissions.length} permissões ativas</p>
              </div>
            </div>
            <p className="truncate text-slate-500">{me.user.email}</p>
            <Link to="/configuracoes/minha-conta" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
              Senha e sessões ativas <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Resumo executivo"
          description="Faturamento do mês, consultas de hoje, pacientes ativos, meta, projeção, pendências, mensagens e alertas."
          actions={<Badge tone="brand">Fase 2</Badge>}
        />
        <p className="px-5 py-4 text-sm text-slate-600">
          Os indicadores passam a aparecer aqui à medida que agenda, pacientes e financeiro começarem a ter dados. A estrutura de banco para todos eles já está criada.
        </p>
      </Card>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">Módulos em construção</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {modules
          .filter((m) => !m.permission || can(m.permission))
          .map((m) => (
            <Link key={m.to} to={m.to} className="group rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-300">
              <div className="flex items-center justify-between">
                <m.icon className="size-5 text-slate-400 group-hover:text-brand-700" />
                <span className="text-xs font-semibold text-slate-400">Fase {m.phase}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">{m.label}</p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{m.summary}</p>
            </Link>
          ))}
      </div>
    </>
  );
}
