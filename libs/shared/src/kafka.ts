import { Kafka, KafkaConfig, Producer, Consumer, logLevel } from 'kafkajs';
import { EventEnvelope, validateEvent } from './events';
import pino from 'pino';

const log = pino({ name: 'kafka' });

let kafkaSingleton: Kafka | null = null;

export function getKafka(brokers: string[], clientId = process.env.SERVICE_NAME || 'app'): Kafka {
  if (!kafkaSingleton) {
    const cfg: KafkaConfig = {
      clientId,
      brokers,
      logLevel: logLevel.ERROR,
    };
    kafkaSingleton = new Kafka(cfg);
  }
  return kafkaSingleton;
}

export async function createProducer(brokers: string[]): Promise<Producer> {
  const kafka = getKafka(brokers);
  const producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: true });
  await producer.connect();
  return producer;
}

export async function createConsumer(brokers: string[], groupId: string): Promise<Consumer> {
  const kafka = getKafka(brokers);
  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: true });
  await consumer.connect();
  return consumer;
}

export async function publish<T>(producer: Producer, topic: string, event: EventEnvelope<T>) {
  const valid = validateEvent(event);
  if (!valid.ok) {
    throw new Error(`Invalid event ${event.type}: ${valid.error}`);
  }
  await producer.send({
    topic,
    messages: [
      {
        key: event.key,
        value: JSON.stringify(event),
        headers: Object.fromEntries(
          Object.entries(event.headers || {}).map(([k, v]) => [k, String(v)])
        ),
      },
    ],
  });
}
