import { Collection } from 'mongodb';
import { Producer } from 'kafkajs';
import { EventEnvelope } from './events';
import { publish } from './kafka';

export type OutboxRecord = {
  _id: string; // eventId
  topic: string;
  event: EventEnvelope<any>;
  sentAt?: Date;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function ensureOutboxIndexes(coll: Collection<OutboxRecord>) {
  await coll.createIndex({ sentAt: 1 });
}

export async function enqueueOutbox(coll: Collection<OutboxRecord>, topic: string, event: EventEnvelope<any>) {
  const rec: OutboxRecord = {
    _id: event.eventId,
    topic,
    event,
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  try {
    await coll.insertOne(rec);
  } catch (err: any) {
    if (err?.code === 11000) {
      // duplicate, ignore
      return;
    }
    throw err;
  }
}

export function startOutboxDispatcher(coll: Collection<OutboxRecord>, producer: Producer, options?: { intervalMs?: number }) {
  const interval = options?.intervalMs ?? 500;
  const timer = setInterval(async () => {
    const pending = await coll.find({ sentAt: { $exists: false } }).limit(50).toArray();
    for (const rec of pending) {
      try {
        await publish(producer, rec.topic, rec.event);
        await coll.updateOne({ _id: rec._id }, { $set: { sentAt: new Date(), updatedAt: new Date() } });
      } catch (err: any) {
        await coll.updateOne(
          { _id: rec._id },
          { $set: { lastError: String(err), updatedAt: new Date() }, $inc: { attempts: 1 } }
        );
      }
    }
  }, interval);
  return () => clearInterval(timer);
}
