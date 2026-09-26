import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import { ChevronDown, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { Avatar } from '@/components/ui';
import { Logo } from './AuthLayout';
import { GlobalSearch } from '@/components/GlobalSearch';

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, me } = useAuth();
  const items = NAV.filter((i) => !i.permission || can(i.permission));
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 px-5">
        {me?.organization.logoUrl ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={me.organization.logoUrl} alt="" className="size-9 rounded-lg object-contain ring-1 ring-slate-200" />
            <span className="truncate text-sm font-semibold text-slate-900">{me.organization.clinicName}</span>
          </div>
        ) : (
          <Logo />
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Menu principal">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={clsx('size-[18px]', isActive ? 'text-brand-700' : 'text-slate-400 group-hover:text-slate-600')} />
                <span className="flex-1">{item.label}</span>
                {item.phase && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">F{item.phase}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {me?.organization.logoUrl && <div className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">FisioCRM</div>}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100" aria-expanded={open} aria-haspopup="menu">
        <Avatar name={me.user.name} src={me.user.avatarUrl} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-medium text-slate-800">{me.user.name}</span>
          <span className="block text-xs text-slate-500">{me.user.role.name}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-slate-900">{me.user.name}</p>
            <p className="truncate text-xs text-slate-500">{me.user.email}</p>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/configuracoes/minha-conta');
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <UserRound className="size-4 text-slate-400" /> Minha conta
          </button>
          <button role="menuitem" onClick={() => logout()} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
            <LogOut className="size-4" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const { me } = useAuth();
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-dvh">
      {/* Sidebar fixa em telas grandes */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>

      {/* Gaveta no celular/tablet */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white shadow-xl">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
          <p className="hidden min-w-0 flex-1 truncate text-right text-sm font-medium text-slate-500 lg:block">{me?.organization.clinicName}</p>
          <UserMenu />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
