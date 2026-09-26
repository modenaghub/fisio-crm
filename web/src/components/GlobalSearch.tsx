import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search, UserRound, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar, Spinner } from './ui';

interface Result {
  patients: { id: string; code: string; name: string; phone: string | null; whatsapp: string | null; email: string | null; photoUrl: string | null; age: number | null; stageLabel: string }[];
  leads: { id: string; name: string; phone: string; stageLabel: string }[];
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Busca global: nome, CPF, telefone, WhatsApp, e-mail ou código. Atalho Ctrl+K / ⌘K. */
export function GlobalSearch() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const q = useDebounced(term.trim());
  const enabled = q.length >= 2 && can('patients.read');
  const r = useQuery({ queryKey: ['search', q], queryFn: () => api<Result>(`/search?q=${encodeURIComponent(q)}`), enabled, staleTime: 10_000 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  if (!can('patients.read')) return <div className="flex-1" />;
  const items = [
    ...(r.data?.patients.map((p) => ({ key: p.id, to: `/pacientes/${p.id}`, name: p.name, photo: p.photoUrl, sub: [p.code, p.age !== null ? `${p.age} anos` : null, p.whatsapp ?? p.phone, p.stageLabel].filter(Boolean).join(' · '), lead: false })) ?? []),
    ...(r.data?.leads.map((l) => ({ key: l.id, to: `/crm`, name: l.name, photo: null, sub: `Lead · ${l.stageLabel} · ${l.phone}`, lead: true })) ?? []),
  ];
  const go = (to: string) => {
    navigate(to);
    setOpen(false);
    setTerm('');
    input.current?.blur();
  };

  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={input}
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); setIndex(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter' && items[index]) go(items[index].to);
            if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
          }}
          placeholder="Buscar paciente (nome, CPF, telefone…)"
          aria-label="Busca global"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-16 text-sm placeholder:text-slate-400 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        />
        {term ? (
          <button onClick={() => setTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Limpar"><X className="size-4" /></button>
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-medium text-slate-400 sm:block">Ctrl K</kbd>
        )}
      </div>
      {open && q.length >= 2 && (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:right-auto sm:w-[28rem]">
          {r.isFetching && !r.data && <div className="flex justify-center py-6"><Spinner /></div>}
          {r.data && items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nada encontrado para “{q}”.</p>}
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((it, i) => (
              <li key={it.key}>
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(it.to)}
                  className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left', i === index && 'bg-slate-50')}
                >
                  {it.lead ? <span className="flex size-8 items-center justify-center rounded-full bg-blue-50 text-blue-600"><UserRound className="size-4" /></span> : <Avatar name={it.name} src={it.photo} size="sm" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{it.name}</span>
                    <span className="block truncate text-xs text-slate-500">{it.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
