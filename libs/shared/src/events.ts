import { z } from 'zod';
import { randomUUID } from 'crypto';

export type EventEnvelope<T> = {
  eventId: string; // unique id for idempotency
  type: string; // e.g., order.OrderCreated.v1
  version: number;
  timestamp: string; // ISO
  correlationId: string; // trace id for the saga
  causationId?: string; // id of the event that caused this
  key: string; // partitioning key, e.g., orderId
  payload: T;
  headers?: Record<string, string | number | boolean>;
};

export const baseEvent = z.object({
  orderId: z.string(),
});

// Canonical payloads
export const OrderCreatedV1 = baseEvent.extend({
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
  total: z.number().nonnegative(),
});

export const InventoryReservedV1 = baseEvent.extend({
  reservedItems: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
});

export const InventoryFailedV1 = baseEvent.extend({
  reason: z.string(),
});

export const PaymentAuthorizedV1 = baseEvent.extend({
  amount: z.number().nonnegative(),
  authId: z.string(),
});

export const PaymentFailedV1 = baseEvent.extend({
  reason: z.string(),
});

export const OrderShippedV1 = baseEvent.extend({
  carrier: z.string(),
  trackingId: z.string(),
});

export const ShippingFailedV1 = baseEvent.extend({
  reason: z.string(),
});

export const PaymentRefundedV1 = baseEvent.extend({
  amount: z.number().nonnegative(),
  refundId: z.string(),
});

export const DeadLetterV1 = z.object({
  originalType: z.string(),
  originalEventId: z.string(),
  orderId: z.string().optional(),
  error: z.string(),
  payload: z.any(),
});

// Command events for manual operations / retries
export const RetryRequestedV1 = z.object({
  orderId: z.string(),
  step: z.enum(['inventory', 'payment', 'shipping']),
});

export const CompensationRequestedV1 = z.object({
  orderId: z.string(),
  action: z.enum(['releaseInventory', 'refundPayment']),
});

export type EventName =
  | 'order.OrderCreated.v1'
  | 'inventory.InventoryReserved.v1'
  | 'inventory.InventoryFailed.v1'
  | 'payment.PaymentAuthorized.v1'
  | 'payment.PaymentFailed.v1'
  | 'shipping.OrderShipped.v1'
  | 'shipping.ShippingFailed.v1'
  | 'ops.RetryRequested.v1'
  | 'ops.CompensationRequested.v1'
  | 'payment.PaymentRefunded.v1'
  | 'ops.DeadLetter.v1';

export const schemas: Record<EventName, z.ZodTypeAny> = {
  'order.OrderCreated.v1': OrderCreatedV1,
  'inventory.InventoryReserved.v1': InventoryReservedV1,
  'inventory.InventoryFailed.v1': InventoryFailedV1,
  'payment.PaymentAuthorized.v1': PaymentAuthorizedV1,
  'payment.PaymentFailed.v1': PaymentFailedV1,
  'shipping.OrderShipped.v1': OrderShippedV1,
  'shipping.ShippingFailed.v1': ShippingFailedV1,
  'ops.RetryRequested.v1': RetryRequestedV1,
  'ops.CompensationRequested.v1': CompensationRequestedV1,
  'payment.PaymentRefunded.v1': PaymentRefundedV1,
  'ops.DeadLetter.v1': DeadLetterV1,
};

export function createEvent<T>(
  type: EventName,
  key: string,
  payload: T,
  opts?: { correlationId?: string; causationId?: string; headers?: Record<string, string | number | boolean> }
): EventEnvelope<T> {
  const version = 1;
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const correlationId = opts?.correlationId ?? eventId;
  return {
    eventId,
    type,
    version,
    timestamp: now,
    correlationId,
    causationId: opts?.causationId,
    key,
    payload,
    headers: opts?.headers ?? {},
  };
}

export function validateEvent(envelope: EventEnvelope<any>): { ok: true } | { ok: false; error: string } {
  const schema = schemas[envelope.type as EventName];
  if (!schema) return { ok: false, error: `Unknown event type ${envelope.type}` };
  const result = schema.safeParse(envelope.payload);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true };
}
