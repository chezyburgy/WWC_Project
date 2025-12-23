import { Kafka, logLevel } from 'kafkajs';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

// Project topics
const mainTopics = [
  'order.OrderCreated.v1',
  'inventory.InventoryReserved.v1',
  'inventory.InventoryFailed.v1',
  'payment.PaymentAuthorized.v1',
  'payment.PaymentFailed.v1',
  'payment.PaymentRefunded.v1',
  'shipping.OrderShipped.v1',
  'shipping.ShippingFailed.v1'
];

const opsTopics = [
  'ops.RetryRequested.v1',
  'ops.CompensationRequested.v1'
];

function dlq(topic) { return `${topic}.dlq`; }

const kafka = new Kafka({
  clientId: 'kafka-admin',
  brokers: BROKERS,
  logLevel: logLevel.ERROR,
});

async function ensureTopics() {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const topicsToCreate = [];

    // Main topics: retain for 7 days
    for (const t of mainTopics) {
      topicsToCreate.push({
        topic: t,
        numPartitions: 1,
        replicationFactor: 1,
        configEntries: [
          { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) },
        ],
      });
      topicsToCreate.push({
        topic: dlq(t),
        numPartitions: 1,
        replicationFactor: 1,
        configEntries: [
          { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) },
        ],
      });
    }

    // Ops topics: retain for 1 day
    for (const t of opsTopics) {
      topicsToCreate.push({
        topic: t,
        numPartitions: 1,
        replicationFactor: 1,
        configEntries: [
          { name: 'retention.ms', value: String(24 * 60 * 60 * 1000) },
        ],
      });
      topicsToCreate.push({
        topic: dlq(t),
        numPartitions: 1,
        replicationFactor: 1,
        configEntries: [
          { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) },
        ],
      });
    }

    const created = await admin.createTopics({ topics: topicsToCreate, validateOnly: false, waitForLeaders: true });
    const existing = await admin.listTopics();
    console.log(JSON.stringify({ created, totalTopics: existing.length, sample: existing.slice(0, 20) }, null, 2));
  } finally {
    await admin.disconnect();
  }
}

ensureTopics().catch((err) => {
  console.error('topic creation failed', err);
  process.exit(1);
});
