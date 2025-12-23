import { Collection } from 'mongodb';

export type ProcessedEvent = {
  _id: string; // `${consumerName}:${eventId}`
  consumer: string;
  eventId: string;
  at: Date;
};

export async function ensureIndexes(coll: Collection<ProcessedEvent>) {
  // Avoid creating indexes on _id explicitly (MongoDB creates a unique _id index by default)
  // Create a compound unique index on (consumer, eventId) as a safety net if callers
  // don't use the `${consumer}:${eventId}` pattern for _id.
  try {
    await coll.createIndex({ consumer: 1, eventId: 1 }, { unique: true, name: 'uniq_consumer_event' });
  } catch {
    // best-effort; ignore if index already exists or in cases where the collection is read-only
  }
}

export async function withIdempotency<T>(
  coll: Collection<ProcessedEvent>,
  consumerName: string,
  eventId: string,
  handler: () => Promise<T>
): Promise<{ alreadyProcessed: boolean; result?: T }> {
  const key = `${consumerName}:${eventId}`;
  try {
    await coll.insertOne({ _id: key, consumer: consumerName, eventId, at: new Date() });
  } catch (err: any) {
    if (err?.code === 11000) {
      return { alreadyProcessed: true };
    }
    throw err;
  }
  const result = await handler();
  return { alreadyProcessed: false, result };
}
