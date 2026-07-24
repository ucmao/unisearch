import {
  CONNECTOR_EVENT_SCHEMA_VERSION,
  type ConnectorEvent,
} from './connector-event';

interface ConnectorEventContext {
  runId: string;
  source: string;
}

export type ConnectorEventPayload<Event extends ConnectorEvent = ConnectorEvent> =
  Event extends ConnectorEvent
    ? Omit<Event, 'schemaVersion' | 'runId' | 'source' | 'timestamp' | 'sequence'>
    : never;

class ConnectorEventEmitter {
  private context: ConnectorEventContext | null = null;
  private sequence = 0;

  configure(context: ConnectorEventContext): void {
    this.context = context;
    this.sequence = 0;
  }

  reset(): void {
    this.context = null;
    this.sequence = 0;
  }

  send(payload: ConnectorEventPayload): ConnectorEvent | null {
    if (!this.context) return null;
    const event = {
      ...payload,
      schemaVersion: CONNECTOR_EVENT_SCHEMA_VERSION,
      runId: this.context.runId,
      source: this.context.source,
      timestamp: new Date().toISOString(),
      sequence: this.sequence++,
    } as ConnectorEvent;
    if (process.connected && process.send) {
      try {
        process.send({ type: 'CONNECTOR_EVENT', event });
      } catch {
        // The parent may have exited while the worker is finishing. Storage is
        // authoritative, so a closed telemetry channel must not fail the run.
      }
    }
    return event;
  }
}

export const connectorEventEmitter = new ConnectorEventEmitter();
