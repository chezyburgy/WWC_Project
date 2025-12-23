import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getCollection, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency } from '@ecom/shared';
import { Db, Collection } from 'mongodb';
import { jwtMiddleware } from '@ecom/shared';
import { randomUUID } from 'crypto';

const SERVICE = process.env.SERVICE_NAME || 'order-service';
const PORT = Number(process.env.PORT || 4001);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'order_service';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

// Topics
const TOPICS = {
  orderCreated: 'order.OrderCreated.v1',
  inventoryReserved: 'inventory.InventoryReserved.v1',
  inventoryFailed: 'inventory.InventoryFailed.v1',
  paymentAuthorized: 'payment.PaymentAuthorized.v1',
  paymentFailed: 'payment.PaymentFailed.v1',
  orderShipped: 'shipping.OrderShipped.v1',
  shippingFailed: 'shipping.ShippingFailed.v1',
  retryRequested: 'ops.RetryRequested.v1',
  compensationRequested: 'ops.CompensationRequested.v1',
};

type OrderDoc = {
  _id: string; // orderId
  items: { sku: string; qty: number }[];
  total: number;
  status: 'CREATED' | 'INVENTORY_RESERVED' | 'INVENTORY_FAILED' | 'PAYMENT_AUTHORIZED' | 'PAYMENT_FAILED' | 'SHIPPED' | 'SHIPPING_FAILED' | 'REFUNDED';
  history: { type: string; at: Date; details?: any }[];
  createdAt: Date;
  updatedAt: Date;
  correlationId: string;
};

async function main() {
  const log = createLogger(SERVICE);
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const db: Db = await getDb(MONGO_URL, DB_NAME);
  const orders = db.collection<OrderDoc>('orders');
  const processed = db.collection<{ _id: string; consumer: string; eventId: string; at: Date }>('processed_events');

  // Outbox
  const outbox = db.collection('outbox');
  const producer = await createProducer(KAFKA_BROKERS);
  const stopOutbox = startOutboxDispatcher(outbox as any, producer);

  // Consumer: update order state from downstream events
  const consumer = await createConsumer(KAFKA_BROKERS, `${SERVICE}-group`);
  await consumer.subscribe({ topic: TOPICS.inventoryReserved, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.inventoryFailed, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.paymentAuthorized, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.paymentFailed, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.orderShipped, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.shippingFailed, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const value = message.value?.toString();
        if (!value) return;
        const evt = JSON.parse(value);
        const eventId = evt.eventId as string;
        const consumerName = `${SERVICE}-consumer`;
        const { alreadyProcessed } = await withIdempotency(processed as any, consumerName, eventId, async () => {
          const orderId = evt.payload.orderId as string;
          const now = new Date();
          const hist = { type: topic, at: now, details: evt.payload };
          switch (topic) {
            case TOPICS.inventoryReserved:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'INVENTORY_RESERVED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.inventoryFailed:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'INVENTORY_FAILED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.paymentAuthorized:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'PAYMENT_AUTHORIZED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.paymentFailed:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'PAYMENT_FAILED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.orderShipped:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'SHIPPED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.shippingFailed:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'SHIPPING_FAILED', updatedAt: now }, $push: { history: hist } }
              );
              break;
          }
        });
        if (!alreadyProcessed) {
          eventsProcessed.inc({ service: SERVICE, eventType: topic, status: 'ok' });
        }
      } catch (err: any) {
        const raw = message.value?.toString();
        let parsed: any = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
        const orderId = parsed?.payload?.orderId || 'unknown';
        const dead = createEvent('ops.DeadLetter.v1', orderId, {
          originalType: parsed?.type || String(topic),
          originalEventId: parsed?.eventId || 'unknown',
          orderId: orderId,
          error: String(err?.message || err),
          payload: parsed?.payload,
        });
        await enqueueOutbox(outbox as any, `${String(topic)}.dlq`, dead);
      }
    },
  });

  // Endpoints
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', metricsMiddleware());

  app.post('/orders', async (req, res) => {
    try {
  const { items, total, orderId } = req.body || {};
  const id = orderId || randomUUID();
      const now = new Date();
      const correlationId = id;
      await orders.insertOne({
        _id: id,
        items,
        total,
        status: 'CREATED',
        history: [{ type: 'order.created', at: now, details: { items, total } }],
        createdAt: now,
        updatedAt: now,
        correlationId,
      });
      const event = createEvent('order.OrderCreated.v1', id, { orderId: id, items, total }, { correlationId });
      await enqueueOutbox(outbox as any, 'order.OrderCreated.v1', event);
      res.status(201).json({ orderId: id });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.get('/orders/:id', async (req, res) => {
    const ord = await orders.findOne({ _id: req.params.id });
    if (!ord) return res.status(404).json({ error: 'not found' });
    res.json(ord);
  });

  // Admin operations: protected
  app.post('/admin/retry/:id', jwtMiddleware(false), async (req, res) => {
    const step = (req.body?.step || 'inventory') as 'inventory' | 'payment' | 'shipping';
    const orderId = req.params.id;
    const event = createEvent('ops.RetryRequested.v1', orderId, { orderId, step }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.RetryRequested.v1', event);
    res.json({ ok: true });
  });

  app.post('/admin/compensate/:id', jwtMiddleware(false), async (req, res) => {
    const action = (req.body?.action || 'releaseInventory') as 'releaseInventory' | 'refundPayment';
    const orderId = req.params.id;
    const event = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.CompensationRequested.v1', event);
    res.json({ ok: true });
  });

  app.listen(PORT, () => log.info({ port: PORT }, 'Order service listening'));

  process.on('SIGINT', async () => {
    await consumer.disconnect();
    await producer.disconnect();
    stopOutbox();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
