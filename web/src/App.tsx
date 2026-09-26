import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { ShieldOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { AppLayout } from '@/layouts/AppLayout';
import { DevMailboxPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/pages/auth/AuthPages';
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage';
import { HomePage } from '@/pages/HomePage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { SettingsLayout } from '@/pages/settings/SettingsLayout';
import { AccountPage } from '@/pages/settings/AccountPage';
import { ClinicSettingsPage, HoursSettingsPage, ServicesSettingsPage, UnitsSettingsPage } from '@/pages/settings/ClinicPages';
import { UsersPage } from '@/pages/settings/UsersPage';
import { RolesPage } from '@/pages/settings/RolesPage';
import { AuditPage } from '@/pages/settings/AuditPage';
import { CrmPage } from '@/pages/crm/CrmPage';
import { PatientsPage } from '@/pages/patients/PatientsPage';
import { PatientPage } from '@/pages/patients/PatientPage';
import { SessionsPage } from '@/pages/clinical/SessionsPage';
import { RecordsPage } from '@/pages/clinical/RecordsPage';

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

/** Exige login. Administrador com configuração inicial pendente vai para o primeiro acesso. */
function RequireAuth({ children, allowOnboardingPending = false }: { children: ReactNode; allowOnboardingPending?: boolean }) {
  const { status, me, can } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (!allowOnboardingPending && me && !me.organization.onboardingCompleted && can('settings.manage')) {
    return <Navigate to="/primeiro-acesso" replace />;
  }
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Forbidden() {
  return (
    <EmptyState
      icon={<ShieldOff className="size-6" />}
      title="Sem permissão"
      description="Seu perfil não dá acesso a esta área. Se precisar, peça ao administrador da clínica."
      action={
        <Link to="/">
          <Button variant="outline">Voltar ao início</Button>
        </Link>
      }
    />
  );
}

function Can({ permission, children }: { permission?: string; children: ReactNode }) {
  const { can } = useAuth();
  return permission && !can(permission) ? <Forbidden /> : <>{children}</>;
}

function NotFound() {
  return (
    <EmptyState
      title="Página não encontrada"
      description="O endereço pode ter mudado ou não existir."
      action={
        <Link to="/">
          <Button variant="outline">Ir para o início</Button>
        </Link>
      }
    />
  );
}

// Na prévia publicada (arquivo único), as rotas ficam no # da URL.
const Router = import.meta.env.VITE_DEMO ? HashRouter : BrowserRouter;

export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/entrar" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/cadastro" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="/esqueci-senha" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route path="/dev/emails" element={<DevMailboxPage />} />

        <Route path="/primeiro-acesso" element={<RequireAuth allowOnboardingPending><Can permission="settings.manage"><OnboardingPage /></Can></RequireAuth>} />

        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Can permission="dashboard.view"><HomePage /></Can>} />
          <Route path="crm" element={<Can permission="patients.read"><CrmPage /></Can>} />
          <Route path="pacientes" element={<Can permission="patients.read"><PatientsPage /></Can>} />
          <Route path="pacientes/:id" element={<Can permission="patients.read"><PatientPage /></Can>} />
          <Route path="atendimentos" element={<Can permission="clinical.read"><SessionsPage /></Can>} />
          <Route path="prontuarios" element={<Can permission="clinical.read"><RecordsPage /></Can>} />
          {NAV.filter((n) => n.phase).map((n) => (
            <Route key={n.to} path={n.to.slice(1)} element={<Can permission={n.permission}><ComingSoonPage item={n} /></Can>} />
          ))}
          <Route path="configuracoes" element={<SettingsLayout />}>
            <Route index element={<Navigate to="minha-conta" replace />} />
            <Route path="minha-conta" element={<AccountPage />} />
            <Route path="clinica" element={<Can permission="settings.manage"><ClinicSettingsPage /></Can>} />
            <Route path="horarios" element={<Can permission="schedule.availability"><HoursSettingsPage /></Can>} />
            <Route path="servicos" element={<Can permission="settings.manage"><ServicesSettingsPage /></Can>} />
            <Route path="unidades" element={<Can permission="settings.manage"><UnitsSettingsPage /></Can>} />
            <Route path="usuarios" element={<Can permission="users.manage"><UsersPage /></Can>} />
            <Route path="perfis" element={<Can permission="users.manage"><RolesPage /></Can>} />
            <Route path="auditoria" element={<Can permission="audit.view"><AuditPage /></Can>} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Router>
  );
}
