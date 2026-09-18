import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { DomainEvent, EventPublisher, Logger } from '@civicsos/core';

/**
 * EventBridge publisher.
 *
 * Domain events are published to a dedicated bus so the synchronous request
 * path stays fast: creating a case returns as soon as the case is written, and
 * reminder scheduling, notification and audit fan-out happen afterwards.
 *
 * Publication is best-effort. A citizen's case must not fail to be created
 * because a notification bus was briefly unavailable, so failures are logged
 * and swallowed here rather than propagated.
 */

export interface EventBridgePublisherOptions {
  busName: string;
  source?: string;
  client?: EventBridgeClient;
  logger: Logger;
}

export class EventBridgeEventPublisher implements EventPublisher {
  private readonly client: EventBridgeClient;
  private readonly busName: string;
  private readonly source: string;
  private readonly logger: Logger;

  constructor(options: EventBridgePublisherOptions) {
    this.client = options.client ?? new EventBridgeClient({});
    this.busName = options.busName;
    this.source = options.source ?? 'civicsos.app';
    this.logger = options.logger;
  }

  async publish(event: DomainEvent): Promise<void> {
    try {
      const result = await this.client.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: this.busName,
              Source: this.source,
              DetailType: event.type,
              Time: new Date(event.occurredAt),
              // Ids and small scalars only — no complaint text, no personal data.
              Detail: JSON.stringify({
                caseId: event.caseId,
                ownerId: event.ownerId,
                occurredAt: event.occurredAt,
                ...event.detail,
              }),
            },
          ],
        }),
      );
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        this.logger.warn('event bus rejected an entry', {
          eventType: event.type,
          caseId: event.caseId,
          reason: result.Entries?.[0]?.ErrorCode,
        });
      }
    } catch (error) {
      this.logger.error('event publish failed', { error, eventType: event.type, caseId: event.caseId });
    }
  }
}
