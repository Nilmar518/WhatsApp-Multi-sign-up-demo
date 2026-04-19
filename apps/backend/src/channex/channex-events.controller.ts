import { Controller, Logger, Param, Sse, type MessageEvent } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import {
  CHANNEX_EVENTS,
  type ChannexBaseEvent,
} from './channex.types';

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * ChannexEventsController — streams Channex integration events to the frontend
 * over Server-Sent Events (SSE).
 *
 * Route: GET /channex/events/:tenantId
 *
 * Event types forwarded:
 *   - channex.connection_status_change  → update the status chip
 *   - channex.booking_new               → show a new-booking toast
 *   - channex.booking_unmapped_room     → trigger the UnmappedRoomModal
 *
 * Filtering:
 *   All Channex internal events carry a `tenantId` field. Only events matching
 *   the `:tenantId` path param are forwarded to the connected client — this
 *   provides multi-tenant isolation without a message broker. Tenants on the
 *   same NestJS instance cannot receive each other's events.
 *
 * Transport details:
 *   - NestJS handles the `Content-Type: text/event-stream` header automatically.
 *   - The `data` field of each MessageEvent is serialized to JSON by the framework.
 *   - The frontend `EventSource` parses `event.data` as JSON in its `onmessage`
 *     handler. `event.type` defaults to `'message'` — the frontend reads the
 *     `type` field from the parsed `data` object instead of the SSE `event` field.
 *
 * Cleanup:
 *   The Observable teardown function removes all EventEmitter2 listeners when
 *   the client disconnects (tab close, navigate away, component unmount). This
 *   prevents listener leaks on long-lived NestJS processes with many clients.
 *
 * CORS:
 *   The Vite dev proxy forwards `/api/channex/events/:tenantId` to NestJS, so
 *   no explicit CORS header is needed. In production, guard this endpoint with
 *   an auth middleware and verify the tenantId matches the session token.
 */
@Controller('channex/events')
export class ChannexEventsController {
  private readonly logger = new Logger(ChannexEventsController.name);

  constructor(private readonly emitter: EventEmitter2) {}

  /**
   * GET /channex/events/:tenantId
   *
   * Opens an SSE stream for the given tenant. Each internal Channex event is
   * evaluated against the tenantId filter — matching events are forwarded as
   * `{ data: { type, ...payload } }` MessageEvent objects.
   *
   * The Observable subscriber is kept open indefinitely until the client
   * disconnects; NestJS detects the closed connection and triggers teardown.
   */
  @Sse(':tenantId')
  stream(@Param('tenantId') tenantId: string): Observable<MessageEvent> {
    this.logger.log(`[SSE] Client connected — tenantId=${tenantId}`);

    return new Observable<MessageEvent>((subscriber) => {
      /**
       * Generic forwarding factory.
       * Creates a typed listener that:
       *   1. Casts the payload to ChannexBaseEvent (all events extend this)
       *   2. Drops the event if tenantId does not match the connected client
       *   3. Emits the event as an SSE MessageEvent with a discriminant `type` field
       */
      const makeForwarder =
        (type: string) =>
        (payload: ChannexBaseEvent & Record<string, unknown>): void => {
          if (payload.tenantId !== tenantId) return;

          this.logger.debug(
            `[SSE] Forwarding type=${type} tenantId=${tenantId}`,
          );

          subscriber.next({ data: { type, ...payload } } as MessageEvent);
        };

      const statusHandler  = makeForwarder('connection_status_change');
      const bookingHandler = makeForwarder('booking_new');
      const unmappedHandler = makeForwarder('booking_unmapped_room');

      this.emitter.on(CHANNEX_EVENTS.CONNECTION_STATUS_CHANGE, statusHandler);
      this.emitter.on(CHANNEX_EVENTS.BOOKING_NEW, bookingHandler);
      this.emitter.on(CHANNEX_EVENTS.BOOKING_UNMAPPED_ROOM, unmappedHandler);

      // Teardown — called by NestJS when the HTTP response is closed (client gone).
      return () => {
        this.logger.log(`[SSE] Client disconnected — tenantId=${tenantId}`);
        this.emitter.off(CHANNEX_EVENTS.CONNECTION_STATUS_CHANGE, statusHandler);
        this.emitter.off(CHANNEX_EVENTS.BOOKING_NEW, bookingHandler);
        this.emitter.off(CHANNEX_EVENTS.BOOKING_UNMAPPED_ROOM, unmappedHandler);
      };
    });
  }
}
