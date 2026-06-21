import { EventEmitter } from 'node:events';

export type EventMap = Record<string, (...args: any[]) => void>;

type EventArgs<TEvents extends EventMap> = {
    [K in keyof TEvents]: Parameters<TEvents[K]>;
};

/**
 * EventEmitter con eventos y payloads tipados según `TEvents`.
 * Base del patrón Observer usado por WhatsAppClient: los suscriptores
 * solo conocen el contrato de eventos, nunca al emisor concreto.
 */
export class TypedEventEmitter<TEvents extends EventMap> extends EventEmitter<EventArgs<TEvents>> {}
