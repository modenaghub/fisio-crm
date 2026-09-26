import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Avatar, Input, Spinner } from './ui';

export interface PickedPatient { id: string; name: string; code?: string; photoUrl?: string | null }

/** Busca de paciente para formulários (agenda, atendimento, financeiro). */
export function PatientPicker({ value, onChange, autoFocus }: { value: PickedPatient | null; onChange: (p: PickedPatient | null) => void; autoFocus?: boolean }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const q = useQuery({
    queryKey: ['patient-picker', debounced],
    queryFn: () => api<{ patients: { id: string; name: string; code: string; photoUrl: string | null; phone: string | null; age: number | null }[] }>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2 && !value,
  });
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
        <Avatar name={value.name} src={value.photoUrl} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{value.name}{value.code && <span className="ml-2 text-xs font-normal text-slate-500">{value.code}</span>}</span>
        <button type="button" onClick={() => onChange(null)} className="text-sm font-medium text-brand-700 hover:underline">Trocar</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input autoFocus={autoFocus} leading={<Search className="size-4" />} placeholder="Nome, CPF, telefone ou código" value={term} onChange={(e) => setTerm(e.target.value)} />
      {debounced.length >= 2 && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {q.isFetching && !q.data && <div className="flex justify-center py-3"><Spinner /></div>}
          {q.data?.patients.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nenhum paciente encontrado.</p>}
          {q.data?.patients.map((p) => (
            <button key={p.id} type="button" onClick={() => { onChange(p); setTerm(''); }} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
              <Avatar name={p.name} src={p.photoUrl} size="sm" />
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-900">{p.name}</span><span className="block text-xs text-slate-500">{p.code}{p.age != null && ` · ${p.age} anos`}{p.phone && ` · ${p.phone}`}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
