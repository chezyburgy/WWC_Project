import { createEvent, validateEvent, schemas } from '../events';

describe('event schemas', () => {
  it('validates OrderCreated.v1', () => {
    const evt = createEvent('order.OrderCreated.v1', 'order-1', {
      orderId: 'order-1',
      items: [{ sku: 'SKU-1', qty: 2 }],
      total: 20,
    });
    const res = validateEvent(evt as any);
    expect(res).toEqual({ ok: true });
  });

  it('rejects invalid payload', () => {
    const evt = createEvent('order.OrderCreated.v1', 'order-1', {
      orderId: 'order-1',
      items: [{ sku: 'SKU-1', qty: -2 }],
      total: 20,
    } as any);
    const res = validateEvent(evt as any);
    expect(res.ok).toBe(false);
  });
});
