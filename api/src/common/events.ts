import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * Barramento interno de eventos de domínio (ex.: "appointment.no_show").
 * Automações, notificações e lembretes assinam estes eventos sem acoplar os módulos.
 * Os ouvintes rodam depois da transação que gerou o evento; falhas são registradas e não afetam a requisição.
 */
export type DomainEvent =
  | 'appointment.created'
  | 'appointment.status_changed'
  | 'appointment.no_show'
  | 'appointment.cancelled'
  | 'session.registered'
  | 'lead.created'
  | 'patient.created'
  | 'payment.received'
  | 'message.received';

export interface EventPayload {
  organizationId: string;
  actorUserId?: string | null;
  entityId: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  private readonly bus = new EventEmitter();
  private readonly logger = new Logger('Events');

  emit(event: DomainEvent, payload: EventPayload) {
    setImmediate(() => this.bus.emit(event, payload));
  }

  on(event: DomainEvent, handler: (p: EventPayload) => Promise<unknown> | unknown) {
    this.bus.on(event, (p: EventPayload) => {
      Promise.resolve()
        .then(() => handler(p))
        .catch((e) => this.logger.error(`Falha ao processar ${event}: ${(e as Error).message}`));
    });
  }
}

@Global()
@Module({ providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
