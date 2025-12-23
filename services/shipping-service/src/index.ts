import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency } from '@ecom/shared';
import { Db } from 'mongodb';

const SERVICE = process.env.SERVICE_NAME || 'shipping-service';
const PORT = Number(process.env.PORT || 4004);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'shipping_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

const TOPICS = {
  paymentAuthorized: 'payment.PaymentAuthorized.v1',
  orderShipped: 'shipping.OrderShipped.v1',
  shippingFailed: 'shipping.ShippingFailed.v1',
  retryRequested: 'ops.RetryRequested.v1',
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
  await consumer.subscribe({ topic: TOPICS.paymentAuthorized, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.retryRequested, fromBeginning: true });

  function simulateShipping(): { ok: true; carrier: string; trackingId: string } | { ok: false; reason: string } {
    const ok = Math.random() < 0.95;
    if (ok) return { ok: true, carrier: 'UPS', trackingId: Math.random().toString(36).slice(2) };
    return { ok: false, reason: 'carrier_error' };
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
          if (topic === TOPICS.paymentAuthorized) {
            const { orderId } = evt.payload;
            const result = simulateShipping();
            if (result.ok) {
              const e = createEvent('shipping.OrderShipped.v1', orderId, { orderId, carrier: result.carrier, trackingId: result.trackingId }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'shipping.OrderShipped.v1', e);
            } else {
              const e = createEvent('shipping.ShippingFailed.v1', orderId, { orderId, reason: result.reason }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'shipping.ShippingFailed.v1', e);
            }
          } else if (topic === TOPICS.retryRequested && evt.payload.step === 'shipping') {
            const { orderId } = evt.payload;
            const e = createEvent('shipping.OrderShipped.v1', orderId, { orderId, carrier: 'UPS', trackingId: Math.random().toString(36).slice(2) }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'shipping.OrderShipped.v1', e);
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

  app.listen(PORT, () => log.info({ port: PORT }, 'Shipping service listening'));

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
