import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency } from '@ecom/shared';
import { Db } from 'mongodb';

const SERVICE = process.env.SERVICE_NAME || 'inventory-service';
const PORT = Number(process.env.PORT || 4002);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'inventory_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

const TOPICS = {
  orderCreated: 'order.OrderCreated.v1',
  inventoryReserved: 'inventory.InventoryReserved.v1',
  inventoryFailed: 'inventory.InventoryFailed.v1',
  retryRequested: 'ops.RetryRequested.v1',
  compensationRequested: 'ops.CompensationRequested.v1',
};

async function main() {
  const log = createLogger(SERVICE);
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const db: Db = await getDb(MONGO_URL, DB_NAME);
  const processed = db.collection<{ _id: string; consumer: string; eventId: string; at: Date }>('processed_events');
  const outbox = db.collection('outbox');
  const producer = await createProducer(KAFKA_BROKERS);
  const stopOutbox = startOutboxDispatcher(outbox as any, producer);

  const consumer = await createConsumer(KAFKA_BROKERS, `${SERVICE}-group`);
  await consumer.subscribe({ topic: TOPICS.orderCreated, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.retryRequested, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.compensationRequested, fromBeginning: true });

  function simulateReserve(items: any[]): { ok: true; reservedItems: any[] } | { ok: false; reason: string } {
    // simulate 85% success
    const ok = Math.random() < 0.85;
    if (ok) return { ok: true, reservedItems: items };
    return { ok: false, reason: 'out_of_stock' };
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const value = message.value?.toString();
        if (!value) return;
        const evt = JSON.parse(value);
        const eventId = evt.eventId as string;
        const consumerName = `${SERVICE}-consumer`;
        const { alreadyProcessed } = await withIdempotency(processed as any, consumerName, eventId, async () => {
          if (topic === TOPICS.orderCreated) {
            const { orderId, items } = evt.payload;
            const result = simulateReserve(items);
            if (result.ok) {
              const e = createEvent('inventory.InventoryReserved.v1', orderId, { orderId, reservedItems: result.reservedItems }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'inventory.InventoryReserved.v1', e);
            } else {
              const e = createEvent('inventory.InventoryFailed.v1', orderId, { orderId, reason: result.reason }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'inventory.InventoryFailed.v1', e);
            }
          } else if (topic === TOPICS.retryRequested && evt.payload.step === 'inventory') {
            const { orderId } = evt.payload;
            // naive retry: emit reserved success again
            const e = createEvent('inventory.InventoryReserved.v1', orderId, { orderId, reservedItems: [] }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'inventory.InventoryReserved.v1', e);
          } else if (topic === TOPICS.compensationRequested && evt.payload.action === 'releaseInventory') {
            const { orderId } = evt.payload;
            const e = createEvent('inventory.InventoryFailed.v1', orderId, { orderId, reason: 'released' }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'inventory.InventoryFailed.v1', e);
          }
        });
        if (!alreadyProcessed) eventsProcessed.inc({ service: SERVICE, eventType: topic, status: 'ok' });
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

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', metricsMiddleware());

  app.listen(PORT, () => log.info({ port: PORT }, 'Inventory service listening'));

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
