import { MongoClient, Db, Collection, Document } from 'mongodb';
import pino from 'pino';

const log = pino({ name: 'mongo' });

let cachedClient: MongoClient | null = null;
let cachedDbs: Record<string, Db> = {};

export async function getMongoClient(mongoUrl: string): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(mongoUrl);
  await client.connect();
  cachedClient = client;
  log.info({ mongoUrl }, 'Mongo connected');
  return client;
}

export async function getDb(mongoUrl: string, dbName: string): Promise<Db> {
  if (cachedDbs[dbName]) return cachedDbs[dbName];
  const client = await getMongoClient(mongoUrl);
  const db = client.db(dbName);
  cachedDbs[dbName] = db;
  return db;
}

export async function getCollection<T extends Document>(mongoUrl: string, dbName: string, coll: string): Promise<Collection<T>> {
  const db = await getDb(mongoUrl, dbName);
  return db.collection<T>(coll);
}
