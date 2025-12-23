import { Kafka, logLevel } from 'kafkajs';
import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const READ_MODEL_URL = process.env.READ_MODEL_URL || 'http://localhost:4005';

function createEvent(type, key, payload, opts = {}) {
  const eventId = randomUUID();
  const correlationId = opts.correlationId || key;
  return {
    eventId,
    type,
    version: 1,
    timestamp: new Date().toISOString(),
    correlationId,
    causationId: opts.causationId,
    key,
    payload,
    headers: opts.headers || {},
  };
}

async function getOrders(status) {
  const url = status ? `${READ_MODEL_URL}/orders?status=${encodeURIComponent(status)}` : `${READ_MODEL_URL}/orders`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
  return r.json();
}

async function main() {
  // Pick a few orders across statuses to target retries/compensations
  const failedInv = await getOrders('INVENTORY_FAILED');
  const failedPay = await getOrders('PAYMENT_FAILED');
  const shipped = await getOrders('SHIPPED');
  const refunded = await getOrders('REFUNDED');

  const pickIds = (arr, n) => (arr || []).slice(0, n).map(d => d._id);
  const ids = {
    invFailed: pickIds(failedInv, 3),
    payFailed: pickIds(failedPay, 3),
    shipped: pickIds(shipped, 2),
    refunded: pickIds(refunded, 2),
  };

  const kafka = new Kafka({ clientId: 'kafka-admin-ops', brokers: BROKERS, logLevel: logLevel.ERROR });
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  try {
    const messages = [];

    // Retry inventory for inventory failures
    for (const orderId of ids.invFailed) {
      const e = createEvent('ops.RetryRequested.v1', orderId, { orderId, step: 'inventory' });
      messages.push({ topic: 'ops.RetryRequested.v1', key: orderId, value: JSON.stringify(e) });
    }

    // Retry payment for payment failures
    for (const orderId of ids.payFailed) {
      const e = createEvent('ops.RetryRequested.v1', orderId, { orderId, step: 'payment' });
      messages.push({ topic: 'ops.RetryRequested.v1', key: orderId, value: JSON.stringify(e) });
    }

    // Compensate (refund) a couple of shipped orders just to populate ops.CompensationRequested
    for (const orderId of ids.shipped) {
      const e = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action: 'refundPayment' });
      messages.push({ topic: 'ops.CompensationRequested.v1', key: orderId, value: JSON.stringify(e) });
    }

    // Also request releaseInventory on refunded ones to show another path
    for (const orderId of ids.refunded) {
      const e = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action: 'releaseInventory' });
      messages.push({ topic: 'ops.CompensationRequested.v1', key: orderId, value: JSON.stringify(e) });
    }

    // Send batched by topic
    const byTopic = messages.reduce((acc, m) => { (acc[m.topic] = acc[m.topic] || []).push(m); return acc; }, {});
    for (const [topic, msgs] of Object.entries(byTopic)) {
      await producer.send({ topic, messages: msgs.map(m => ({ key: m.key, value: m.value })) });
    }
    console.log(`seeded ops events:`, Object.fromEntries(Object.entries(byTopic).map(([t, arr]) => [t, arr.length])));
  } finally {
    await producer.disconnect();
  }
}

main().catch((err) => { console.error('seed ops failed', err); process.exit(1); });
