import { connectorEventEmitter } from '../contracts/connector-event-emitter';
import type { RawItem } from '../contracts/raw-item';
import type { OutputSinkContext, OutputSinkResult } from './types';
import { BaseOutputSink } from './types';

export const CONNECTOR_EVENT_MESSAGE = 'CONNECTOR_EVENT' as const;

export class IpcOutputSink extends BaseOutputSink {
  override async open(context: OutputSinkContext): Promise<void> {
    connectorEventEmitter.configure(context);
    connectorEventEmitter.send({ type: 'ready' });
    connectorEventEmitter.send({ type: 'started' });
  }

  async write(item: RawItem): Promise<void> {
    connectorEventEmitter.send({ type: 'item', item });
  }

  override async close(result: OutputSinkResult): Promise<void> {
    if (result.status === 'completed') {
      connectorEventEmitter.send({ type: 'completed', itemCount: result.itemCount });
    } else if (result.status === 'cancelled') {
      connectorEventEmitter.send({ type: 'cancelled' });
    } else {
      connectorEventEmitter.send({
        type: 'failed',
        code: 'UNKNOWN',
        message: result.error || 'Connector failed',
        retryable: false,
      });
    }
    connectorEventEmitter.reset();
  }

  override async abort(error: Error): Promise<void> {
    connectorEventEmitter.send({ type: 'failed', code: 'UNKNOWN', message: error.message, retryable: false });
    connectorEventEmitter.reset();
  }
}
