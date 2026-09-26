export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
    role: { id: string; key: string; name: string };
    isProfessional: boolean;
    units: { id: string; name: string }[];
    lastLoginAt: string | null;
  };
  organization: {
    id: string;
    name: string;
    clinicName: string;
    logoUrl: string | null;
    timezone: string;
    onboardingCompleted: boolean;
    onboardingStep: number;
  };
  permissions: string[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string };
  professional: { crefito: string | null; specialties: string[]; calendarColor: string } | null;
  units: { id: string; name: string }[];
  overrides: { permissionCode: string; granted: boolean }[];
  permissions: string[];
}

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isLocked: boolean;
  activeUsers: number;
  permissions: string[];
}

export interface PermissionGroup {
  module: string;
  permissions: { code: string; description: string }[];
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export type ServiceKind = 'EVALUATION' | 'SESSION' | 'PACKAGE' | 'OTHER';

export interface ServiceRow {
  id: string;
  name: string;
  kind: ServiceKind;
  durationMinutes: number;
  priceCents: number;
}

export interface DayHours {
  weekday: number;
  intervals: { start: string; end: string }[];
}

export type PaymentMethod = 'PIX' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BANK_TRANSFER' | 'BOLETO' | 'HEALTH_INSURANCE' | 'OTHER';
