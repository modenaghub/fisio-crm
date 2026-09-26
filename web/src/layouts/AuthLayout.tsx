import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#0f766e" />
        <path d="M8.5 17h4l2-5 3 9 2-4h4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-lg font-semibold tracking-tight text-slate-900">
        Fisio<span className="text-brand-700">CRM</span>
      </span>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-brand-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="relative flex items-center gap-2.5 text-white">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
            <rect width="32" height="32" rx="9" fill="#fff" fillOpacity=".12" />
            <path d="M8.5 17h4l2-5 3 9 2-4h4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-lg font-semibold">FisioCRM</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">Sua clínica inteira em um só lugar.</h2>
          <p className="mt-4 text-brand-100/80">
            Pacientes, prontuário, agenda, WhatsApp e financeiro — com a segurança que dados de saúde exigem.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-50/90">
            {['Prontuário com histórico permanente e auditoria', 'Controle de acesso por perfil', 'Projetado para a LGPD'].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <ShieldCheck className="size-4 text-brand-300" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-200/60">© {new Date().getFullYear()} FisioCRM</p>
      </aside>
      <main className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
