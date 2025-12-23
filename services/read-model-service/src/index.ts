import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency, jwtMiddleware } from '@ecom/shared';
import { Db } from 'mongodb';

const SERVICE = process.env.SERVICE_NAME || 'read-model-service';
const PORT = Number(process.env.PORT || 4005);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'read_model_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const TOPICS = [
  'order.OrderCreated.v1',
  'inventory.InventoryReserved.v1',
  'inventory.InventoryFailed.v1',
  'payment.PaymentAuthorized.v1',
  'payment.PaymentFailed.v1',
  'shipping.OrderShipped.v1',
  'shipping.ShippingFailed.v1',
  'payment.PaymentRefunded.v1',
];

async function main() {
  const log = createLogger(SERVICE);
  const app = express();
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(bodyParser.json());

  const db: Db = await getDb(MONGO_URL, DB_NAME);
  const processed = db.collection<{ _id: string; consumer: string; eventId: string; at: Date }>('processed_events');
  const projections = db.collection<any>('orders_projection');

  const outbox = db.collection('outbox');
  const producer = await createProducer(KAFKA_BROKERS);
  const stopOutbox = startOutboxDispatcher(outbox as any, producer);

  const consumer = await createConsumer(KAFKA_BROKERS, `${SERVICE}-group`);
  for (const t of TOPICS) await consumer.subscribe({ topic: t, fromBeginning: true });

  type Client = { res: any };
  const sseClients: Record<string, Set<Client>> = {};

  function broadcast(orderId: string, data: any) {
    const set = sseClients[orderId];
    if (!set) return;
    for (const c of set) {
      c.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value?.toString();
      if (!value) return;
      const evt = JSON.parse(value);
      const eventId = evt.eventId as string;
      const consumerName = `${SERVICE}-consumer`;
      const { alreadyProcessed } = await withIdempotency(processed as any, consumerName, eventId, async () => {
        const orderId = evt.payload.orderId as string;
        const now = new Date();
        const statusMap: any = {
          'order.OrderCreated.v1': 'CREATED',
          'inventory.InventoryReserved.v1': 'INVENTORY_RESERVED',
          'inventory.InventoryFailed.v1': 'INVENTORY_FAILED',
          'payment.PaymentAuthorized.v1': 'PAYMENT_AUTHORIZED',
          'payment.PaymentFailed.v1': 'PAYMENT_FAILED',
          'shipping.OrderShipped.v1': 'SHIPPED',
          'shipping.ShippingFailed.v1': 'SHIPPING_FAILED',
          'payment.PaymentRefunded.v1': 'REFUNDED',
        };
        const status = statusMap[topic] || 'UNKNOWN';

        await projections.updateOne(
          { _id: orderId },
          {
            $setOnInsert: { createdAt: now },
            $set: { updatedAt: now, currentStatus: status },
            // cast to any to avoid overly strict generics from mongodb types
            $push: { timeline: { type: topic, at: now, details: evt.payload } } as any,
          },
          { upsert: true }
        );
        broadcast(orderId, { type: topic, at: now, details: evt.payload, status });
      });
      if (!alreadyProcessed) eventsProcessed.inc({ service: SERVICE, eventType: topic, status: 'ok' });
    },
  });

  // REST
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', metricsMiddleware());

  app.get('/orders', async (req, res) => {
    const status = req.query.status as string | undefined;
    const q: any = {};
    if (status) q.currentStatus = status;
    const list = await projections.find(q).sort({ updatedAt: -1 }).limit(100).toArray();
    res.json(list);
  });

  app.get('/orders/:id', async (req, res) => {
    const doc = await projections.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json(doc);
  });

  app.get('/orders/:id/stream', async (req, res) => {
    const orderId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const set = (sseClients[orderId] = sseClients[orderId] || new Set());
    const client = { res };
    set.add(client);
    req.on('close', () => {
      set.delete(client);
      if (set.size === 0) delete sseClients[orderId];
    });
  });

  // Admin: produce retry/compensation commands
  app.post('/admin/retry/:id', jwtMiddleware(true), async (req, res) => {
    const orderId = req.params.id;
    const step = (req.body?.step || 'inventory') as 'inventory' | 'payment' | 'shipping';
    const event = createEvent('ops.RetryRequested.v1', orderId, { orderId, step }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.RetryRequested.v1', event);
    res.json({ ok: true });
  });

  app.post('/admin/compensate/:id', jwtMiddleware(true), async (req, res) => {
    const orderId = req.params.id;
    const action = (req.body?.action || 'releaseInventory') as 'releaseInventory' | 'refundPayment';
    const event = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.CompensationRequested.v1', event);
    res.json({ ok: true });
  });

  app.listen(PORT, () => log.info({ port: PORT }, 'Read-model service listening'));

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
