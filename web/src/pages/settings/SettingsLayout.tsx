import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import clsx from 'clsx';
import { Building2, CalendarClock, History, KeyRound, MapPin, ShieldCheck, Tags, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';

export const SETTINGS_SECTIONS = [
  { to: 'minha-conta', label: 'Minha conta', icon: KeyRound },
  { to: 'clinica', label: 'Clínica', icon: Building2, permission: 'settings.manage' },
  { to: 'horarios', label: 'Horários', icon: CalendarClock, permission: 'schedule.availability' },
  { to: 'servicos', label: 'Serviços e valores', icon: Tags, permission: 'settings.manage' },
  { to: 'unidades', label: 'Unidades', icon: MapPin, permission: 'settings.manage' },
  { to: 'usuarios', label: 'Usuários', icon: Users, permission: 'users.manage' },
  { to: 'perfis', label: 'Perfis e permissões', icon: ShieldCheck, permission: 'users.manage' },
  { to: 'auditoria', label: 'Auditoria', icon: History, permission: 'audit.view' },
];

export function SettingsLayout() {
  const { can } = useAuth();
  const sections = SETTINGS_SECTIONS.filter((s) => !s.permission || can(s.permission));
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // No celular a lista de seções rola na horizontal: mantém a seção atual visível.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav ref={nav} className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0" aria-label="Seções de configurações">
          {sections.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) =>
                clsx(
                  'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900',
                )
              }
            >
              <s.icon className="size-4" /> {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </>
  );
}
