/**
 * Contrato de sincronização de agenda — Fase 5.
 * INTEGRAÇÃO REAL: Google Calendar API com OAuth por profissional
 * (ProfessionalProfile.externalCalendarId; Appointment.externalEventId).
 */
export interface CalendarEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  description?: string;
}

export interface CalendarProvider {
  readonly mode: 'mock' | 'real';
  upsertEvent(calendarId: string, event: CalendarEvent, externalId?: string): Promise<{ externalId: string }>;
  deleteEvent(calendarId: string, externalId: string): Promise<void>;
}

export const CALENDAR_PROVIDER = Symbol('CALENDAR_PROVIDER');

export class MockCalendarProvider implements CalendarProvider {
  readonly mode = 'mock' as const;
  async upsertEvent(_c: string, _e: CalendarEvent, externalId?: string) {
    return { externalId: externalId ?? `mock-event-${Date.now()}` };
  }
  async deleteEvent() {}
}
