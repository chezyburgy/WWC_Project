import { Kafka, logLevel } from 'kafkajs';
import { randomUUID } from 'node:crypto';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const TOPICS = (process.env.TOPICS || [
  'order.OrderCreated.v1',
  'inventory.InventoryReserved.v1',
  'inventory.InventoryFailed.v1',
  'payment.PaymentAuthorized.v1',
  'payment.PaymentFailed.v1',
  'payment.PaymentRefunded.v1',
  'shipping.OrderShipped.v1',
  'shipping.ShippingFailed.v1',
  'ops.RetryRequested.v1',
  'ops.CompensationRequested.v1'
].join(',')).split(',');
const MAX_PER_TOPIC = Number(process.env.MAX_PER_TOPIC || 5);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 3000);

async function peekTopic(kafka, topic) {
  const groupId = `peek-${topic}-${randomUUID()}`;
  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  const messages = [];
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  const timer = setTimeout(async () => {
    try { await consumer.disconnect(); } catch {}
  }, TIMEOUT_MS);
  await consumer.run({
    eachMessage: async ({ message }) => {
      messages.push(message);
      if (messages.length >= MAX_PER_TOPIC) {
        clearTimeout(timer);
        await consumer.disconnect();
      }
    },
  });
  return new Promise((resolve) => {
    const fin = setInterval(async () => {
      if (!consumer['connection']) {
        clearInterval(fin);
        resolve(messages);
      }
    }, 100);
  });
}

async function main() {
  const kafka = new Kafka({ clientId: 'kafka-peek', brokers: BROKERS, logLevel: logLevel.ERROR });
  const out = {};
  for (const t of TOPICS) {
    try {
      const msgs = await peekTopic(kafka, t);
      out[t] = msgs.length;
    } catch (e) {
      out[t] = `err: ${String(e.message || e)}`;
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('peek failed', e); process.exit(1); });
