import { Kafka, logLevel } from 'kafkajs';
import { randomUUID } from 'node:crypto';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const TOPIC = 'order.OrderCreated.v1';

function createEvent(type, key, payload, opts = {}) {
  const version = 1;
  const eventId = randomUUID();
  const correlationId = opts.correlationId || eventId;
  return {
    eventId,
    type,
    version,
    timestamp: new Date().toISOString(),
    correlationId,
    causationId: opts.causationId,
    key,
    payload,
    headers: opts.headers || {},
  };
}

function randomItems() {
  const n = 1 + Math.floor(Math.random() * 3);
  return Array.from({ length: n }, () => ({ sku: `SKU-${1 + Math.floor(Math.random()*100)}`, qty: 1 + Math.floor(Math.random()*3) }));
}

function buildOrders(count = 10) {
  return Array.from({ length: count }, () => {
    const orderId = randomUUID();
    const items = randomItems();
    const total = items.reduce((s, it) => s + it.qty * 10, 0);
    const event = createEvent('order.OrderCreated.v1', orderId, { orderId, items, total }, { correlationId: orderId });
    return { orderId, event };
  });
}

async function main() {
  const COUNT = Number(process.env.COUNT || 10);
  const kafka = new Kafka({ clientId: 'kafka-admin-seeder', brokers: BROKERS, logLevel: logLevel.ERROR });
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  try {
    const orders = buildOrders(COUNT);
    const messages = orders.map(({ orderId, event }) => ({ key: orderId, value: JSON.stringify(event) }));
    await producer.send({ topic: TOPIC, messages });
    console.log(`seeded ${orders.length} orders to ${TOPIC}`);
    console.log(orders.map(o => o.orderId).join('\n'));
  } finally {
    await producer.disconnect();
  }
}

main().catch((err) => { console.error('seed failed', err); process.exit(1); });
