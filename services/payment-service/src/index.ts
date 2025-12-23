import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency } from '@ecom/shared';
import { Db } from 'mongodb';

const SERVICE = process.env.SERVICE_NAME || 'payment-service';
const PORT = Number(process.env.PORT || 4003);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'payment_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

const TOPICS = {
  inventoryReserved: 'inventory.InventoryReserved.v1',
  paymentAuthorized: 'payment.PaymentAuthorized.v1',
  paymentFailed: 'payment.PaymentFailed.v1',
  compensationRequested: 'ops.CompensationRequested.v1',
  retryRequested: 'ops.RetryRequested.v1',
  paymentRefunded: 'payment.PaymentRefunded.v1',
  shippingFailed: 'shipping.ShippingFailed.v1',
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
  await consumer.subscribe({ topic: TOPICS.inventoryReserved, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.retryRequested, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.compensationRequested, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.shippingFailed, fromBeginning: true });

  function simulatePayment(amount: number): { ok: true; authId: string } | { ok: false; reason: string } {
    const ok = Math.random() < 0.9;
    if (ok) return { ok: true, authId: Math.random().toString(36).slice(2) };
    return { ok: false, reason: 'card_declined' };
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
          if (topic === TOPICS.inventoryReserved) {
            const { orderId } = evt.payload;
            const amount = evt.payload.total || 0; // in real system, join from read model
            const result = simulatePayment(amount);
            if (result.ok) {
              const e = createEvent('payment.PaymentAuthorized.v1', orderId, { orderId, amount, authId: result.authId }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'payment.PaymentAuthorized.v1', e);
            } else {
              const e = createEvent('payment.PaymentFailed.v1', orderId, { orderId, reason: result.reason }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'payment.PaymentFailed.v1', e);
              // trigger compensation to release inventory
              const c = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action: 'releaseInventory' }, { correlationId: evt.correlationId, causationId: e.eventId });
              await enqueueOutbox(outbox as any, 'ops.CompensationRequested.v1', c);
            }
          } else if (topic === TOPICS.retryRequested && evt.payload.step === 'payment') {
            const { orderId } = evt.payload;
            const e = createEvent('payment.PaymentAuthorized.v1', orderId, { orderId, amount: 0, authId: Math.random().toString(36).slice(2) }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'payment.PaymentAuthorized.v1', e);
          } else if (topic === TOPICS.compensationRequested && evt.payload.action === 'refundPayment') {
            const { orderId } = evt.payload;
            const e = createEvent('payment.PaymentRefunded.v1', orderId, { orderId, amount: 0, refundId: Math.random().toString(36).slice(2) }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'payment.PaymentRefunded.v1', e);
          } else if (topic === TOPICS.shippingFailed) {
            const { orderId } = evt.payload;
            // on shipping failure, trigger refund
            const c = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action: 'refundPayment' }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'ops.CompensationRequested.v1', c);
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

  app.listen(PORT, () => log.info({ port: PORT }, 'Payment service listening'));

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
