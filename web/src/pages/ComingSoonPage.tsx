import { Check } from 'lucide-react';
import type { NavItem } from '@/lib/nav';
import { Badge, Card, PageHeader } from '@/components/ui';

export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.summary} actions={<Badge tone="brand">Fase {item.phase}</Badge>} />
      <Card className="p-6 sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <item.icon className="size-6" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">Este módulo será entregue na Fase {item.phase}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          As tabelas, permissões e trilha de auditoria que ele usa já existem. O que vai estar aqui:
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {item.features?.map((f) => (
            <li key={f} className="flex gap-2.5 text-sm text-slate-700">
              <Check className="mt-0.5 size-4 shrink-0 text-brand-700" /> {f}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
