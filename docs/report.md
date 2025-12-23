# Event-driven E-commerce Pipeline


Generated report — 2025-11-03T10:38:55.456Z


This report documents the architecture, services, shared libraries, message schemas, deployment, and operational patterns (idempotency, outbox, DLQ, compensation). It also includes selected source listings for reference and auditability.


---


## Table of Contents

- Architecture Overview
- Shared Library
- Services
- Event Schemas
- Infrastructure (Docker Compose)
- Dashboard
- Load Generator
- Operational Patterns (Idempotency, Outbox, DLQ, Saga)
- Security & Observability
- API & Topics Reference
- Troubleshooting & Future Work
- Appendices: Source Listings



## Architecture Overview

# Event-driven E-commerce Pipeline

A reference, event-driven e-commerce pipeline built with Node.js services, Kafka-compatible broker (Redpanda), MongoDB for state and audit, and a React dashboard for live order timelines.

This repo demonstrates practical patterns: idempotent consumers, outbox, DLQ, saga-style compensation, structured logs, metrics, and JWT-protected admin APIs.

## Repo structure

```
libs/shared           # Shared TS lib: event schemas, Kafka/Mongo wrappers, logging, metrics, auth, idempotency, outbox
services/order-service
services/inventory-service
services/payment-service
services/shipping-service
services/read-model-service
apps/dashboard        # Vite React app for live status
apps/load-generator   # Synthetic order generator
docker-compose.yml    # Redpanda (Kafka), Kafka UI, Mongo
```

## Prerequisites

- macOS with Docker Desktop
- Node.js >= 18.17 (for local dev mode and scripts)

## How to run

You can run the whole stack in Docker, or run infra in Docker and services locally for hot reload.

### Option A: Full stack in Docker (containers for everything)

```zsh
npm run start
```

This sets COMPOSE_PROFILES=infra,app and runs `docker compose up --build`.

URLs when ready:
- Kafka UI: http://localhost:8080
- Mongo: mongodb://localhost:27017
- Services: 4001–4005
- Dashboard: http://localhost:5173

Stop all containers:

```zsh
npm run compose:down
```

### Option B: Local dev (hot reload)

1) Start infra (Kafka via Redpanda, Kafka UI, MongoDB):

```zsh
npm run compose:up:infra
```

2) Start all services + dashboard in watch mode in another terminal:

```zsh
npm run dev
```

Create an order to drive the pipeline:

```zsh
curl -X POST http://localhost:4001/orders \
	-H 'Content-Type: application/json' \
	-d '{"items":[{"sku":"SKU-1","qty":2}],"total":20}'
```

Open the dashboard at http://localhost:5173, select the order, and observe the live timeline via SSE.

## Architecture and flow

Pipeline steps: Order → Inventory Reservation → Payment → Shipping. Failure at any step triggers compensating actions (e.g., release inventory, refund).

- Topics (payload schemas in `libs/shared/src/events.ts`):
	- order.OrderCreated.v1
	- inventory.InventoryReserved.v1 | inventory.InventoryFailed.v1
	- payment.PaymentAuthorized.v1 | payment.PaymentFailed.v1 | payment.PaymentRefunded.v1
	- shipping.OrderShipped.v1 | shipping.ShippingFailed.v1
	- ops.RetryRequested.v1 | ops.CompensationRequested.v1 | ops.DeadLetter.v1

Conventions:
- Partition key: `orderId` for per-order ordering.
- Envelope fields: eventId, type, version, timestamp, correlationId, causationId, key, payload, headers.
- Validation: Zod schemas per version.

Persistence:
- Each service stores its own aggregates and processed-events (idempotency) + outbox for reliable publish.
- Read model projects events into a query-optimized `orders_projection` and serves SSE.

Reliability:
- Idempotent consumers with a processed-events collection (unique _id of `consumer:eventId`).
- Outbox worker reliably publishes queued events.
- DLQ: exceptions in handlers produce `ops.DeadLetter.v1` to `<topic>.dlq` with error and original payload.

Observability:
- Logs: JSON (pino). Metrics: Prometheus via `/metrics`. Health: `/health`.

Security:
- Admin endpoints protected via JWT (HS256, secret `JWT_SECRET`). Avoid PII in events.

## Service endpoints

All services expose:
- GET `/:health` → `{ ok: true }`
- GET `/:metrics` → Prometheus metrics

Order service (http://localhost:4001):
- POST `/orders` → `{ orderId }`  Create an order and emit OrderCreated via outbox
- GET `/orders/:id` → order document
- POST `/admin/retry/:id` (JWT required) body: `{ step: 'inventory'|'payment'|'shipping' }`
- POST `/admin/compensate/:id` (JWT required) body: `{ action: 'releaseInventory'|'refundPayment' }`

Read-model service (http://localhost:4005):
- GET `/orders?status=...` → recent projections
- GET `/orders/:id` → projection
- GET `/orders/:id/stream` → SSE stream for timeline
- POST `/admin/retry/:id` (JWT required)
- POST `/admin/compensate/:id` (JWT required)

## Admin operations (JWT)

Generate a dev token:

```zsh
node -e "console.log(require('jsonwebtoken').sign({sub:'dev'}, 'devsecret', {expiresIn:'1d'}))"
```

Retry payment for an order:

```zsh
TOKEN=<paste>
ORDER_ID=<id>
curl -X POST "http://localhost:4005/admin/retry/$ORDER_ID" \
	-H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"step":"payment"}'
```

Compensate by refunding:

```zsh
curl -X POST "http://localhost:4005/admin/compensate/$ORDER_ID" \
	-H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"action":"refundPayment"}'
```

## Load generator

Generate N orders/second for T seconds:

```zsh
RATE=5 DURATION=30 npm --workspace @ecom/load-generator run start
```

Env:
- ORDER_SERVICE=http://localhost:4001

## Testing

Contract tests for event schemas (Jest) in `libs/shared`:

```zsh
npm run test
```

## Configuration

Common env (provided via compose by default):
- KAFKA_BROKERS: `kafka:9092` (Redpanda in Docker)
- MONGO_URL: `mongodb://mongo:27017`
- JWT_SECRET: set for admin endpoints
- SERVICE_NAME: used for logs/metrics labels

Dashboard env:
- VITE_API_BASE: `http://localhost:4005`

## Kafka UI

Kafka UI at http://localhost:8080 connects to `kafka:9092`. Browse topics, inspect messages, and DLQs (`*.dlq`).

## DLQ and replays

Any consumer exception will emit an `ops.DeadLetter.v1` event to `<topic>.dlq` with:

```json
{
	"originalType": "payment.PaymentAuthorized.v1",
	"originalEventId": "...",
	"orderId": "...",
	"error": "...",
	"payload": { "...original payload..." }
}
```

Operator replay tools can be added next to re-publish a DLQ message to the main topic (not implemented yet).

## Troubleshooting

- Ports busy
	- Stop previous runs: `npm run compose:down`.
- Docker resources
	- Give Docker Desktop at least 4GB memory for Redpanda and Mongo.
- Kafka broker not reachable
	- Ensure `npm run compose:up:infra` shows kafka, kafka-ui, and mongo as running; try `docker compose logs -f kafka`.
- Dashboard loads but no updates
	- Check read-model service logs (port 4005) and verify SSE stream `GET /orders/:id/stream` is open.
- JWT 401
	- Use the dev token above or set `JWT_SECRET` consistently across services.

## Notes

This is a demonstrator. The reservation/authorization/shipping actions are simulated. Replace the simulators with real integrations as needed, and harden retry/backoff policies per your SLAs.




## Core Infrastructure



### docker-compose.yml





















































































































































































































































































































































```yaml
services:
  kafka:
    image: redpandadata/redpanda:v24.1.6
    profiles: ["infra"]
    command:
      - redpanda
      - start
      - --overprovisioned
      - --smp
      - "1"
      - --memory
      - 1G
      - --reserve-memory
      - 0M
      - --node-id
      - "0"
      - --check=false
      - --kafka-addr
      - PLAINTEXT://0.0.0.0:9092,PLAINTEXT_HOST://0.0.0.0:29092
      - --advertise-kafka-addr
      - PLAINTEXT://kafka:9092,PLAINTEXT_HOST://localhost:29092
    ports:
      - "9092:9092"
      - "29092:29092"

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    profiles: ["infra"]
    depends_on:
      - kafka
    environment:
      - KAFKA_CLUSTERS_0_NAME=local
      - KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS=kafka:9092
    ports:
      - "8080:8080"

  mongo:
    image: mongo:6
    profiles: ["infra"]
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

  order-service:
    build:
      context: .
      dockerfile: services/order-service/Dockerfile
    profiles: ["app"]
    environment:
      - PORT=4001
      - KAFKA_BROKERS=kafka:9092
      - MONGO_URL=mongodb://mongo:27017
      - JWT_SECRET=devsecret
      - SERVICE_NAME=order-service
    depends_on:
      - kafka
      - mongo
    ports:
      - "4001:4001"

  inventory-service:
    build:
      context: .
      dockerfile: services/inventory-service/Dockerfile
    profiles: ["app"]
    environment:
      - PORT=4002
      - KAFKA_BROKERS=kafka:9092
      - MONGO_URL=mongodb://mongo:27017
      - JWT_SECRET=devsecret
      - SERVICE_NAME=inventory-service
    depends_on:
      - kafka
      - mongo
    ports:
      - "4002:4002"

  payment-service:
    build:
      context: .
      dockerfile: services/payment-service/Dockerfile
    profiles: ["app"]
    environment:
      - PORT=4003
      - KAFKA_BROKERS=kafka:9092
      - MONGO_URL=mongodb://mongo:27017
      - JWT_SECRET=devsecret
      - SERVICE_NAME=payment-service
    depends_on:
      - kafka
      - mongo
    ports:
      - "4003:4003"

  shipping-service:
    build:
      context: .
      dockerfile: services/shipping-service/Dockerfile
    profiles: ["app"]
    environment:
      - PORT=4004
      - KAFKA_BROKERS=kafka:9092
      - MONGO_URL=mongodb://mongo:27017
      - JWT_SECRET=devsecret
      - SERVICE_NAME=shipping-service
    depends_on:
      - kafka
      - mongo
    ports:
      - "4004:4004"

  read-model-service:
    build:
      context: .
      dockerfile: services/read-model-service/Dockerfile
    profiles: ["app"]
    environment:
      - PORT=4005
      - KAFKA_BROKERS=kafka:9092
      - MONGO_URL=mongodb://mongo:27017
      - JWT_SECRET=devsecret
      - SERVICE_NAME=read-model-service
      - CORS_ORIGIN=*
    depends_on:
      - kafka
      - mongo
    ports:
      - "4005:4005"

  dashboard:
    build:
      context: ./apps/dashboard
      dockerfile: Dockerfile
    profiles: ["app"]
    environment:
      - VITE_API_BASE=http://localhost:4005
    depends_on:
      - read-model-service
    ports:
      - "5173:5173"

volumes:
  mongo-data: {}

```



## Shared Library — Core Modules



### libs/shared/src/events.ts





















































































































































































































































































































































```ts
import { z } from 'zod';
import { randomUUID } from 'crypto';

export type EventEnvelope<T> = {
  eventId: string; // unique id for idempotency
  type: string; // e.g., order.OrderCreated.v1
  version: number;
  timestamp: string; // ISO
  correlationId: string; // trace id for the saga
  causationId?: string; // id of the event that caused this
  key: string; // partitioning key, e.g., orderId
  payload: T;
  headers?: Record<string, string | number | boolean>;
};

export const baseEvent = z.object({
  orderId: z.string(),
});

// Canonical payloads
export const OrderCreatedV1 = baseEvent.extend({
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
  total: z.number().nonnegative(),
});

export const InventoryReservedV1 = baseEvent.extend({
  reservedItems: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
});

export const InventoryFailedV1 = baseEvent.extend({
  reason: z.string(),
});

export const PaymentAuthorizedV1 = baseEvent.extend({
  amount: z.number().nonnegative(),
  authId: z.string(),
});

export const PaymentFailedV1 = baseEvent.extend({
  reason: z.string(),
});

export const OrderShippedV1 = baseEvent.extend({
  carrier: z.string(),
  trackingId: z.string(),
});

export const ShippingFailedV1 = baseEvent.extend({
  reason: z.string(),
});

export const PaymentRefundedV1 = baseEvent.extend({
  amount: z.number().nonnegative(),
  refundId: z.string(),
});

export const DeadLetterV1 = z.object({
  originalType: z.string(),
  originalEventId: z.string(),
  orderId: z.string().optional(),
  error: z.string(),
  payload: z.any(),
});

// Command events for manual operations / retries
export const RetryRequestedV1 = z.object({
  orderId: z.string(),
  step: z.enum(['inventory', 'payment', 'shipping']),
});

export const CompensationRequestedV1 = z.object({
  orderId: z.string(),
  action: z.enum(['releaseInventory', 'refundPayment']),
});

export type EventName =
  | 'order.OrderCreated.v1'
  | 'inventory.InventoryReserved.v1'
  | 'inventory.InventoryFailed.v1'
  | 'payment.PaymentAuthorized.v1'
  | 'payment.PaymentFailed.v1'
  | 'shipping.OrderShipped.v1'
  | 'shipping.ShippingFailed.v1'
  | 'ops.RetryRequested.v1'
  | 'ops.CompensationRequested.v1'
  | 'payment.PaymentRefunded.v1'
  | 'ops.DeadLetter.v1';

export const schemas: Record<EventName, z.ZodTypeAny> = {
  'order.OrderCreated.v1': OrderCreatedV1,
  'inventory.InventoryReserved.v1': InventoryReservedV1,
  'inventory.InventoryFailed.v1': InventoryFailedV1,
  'payment.PaymentAuthorized.v1': PaymentAuthorizedV1,
  'payment.PaymentFailed.v1': PaymentFailedV1,
  'shipping.OrderShipped.v1': OrderShippedV1,
  'shipping.ShippingFailed.v1': ShippingFailedV1,
  'ops.RetryRequested.v1': RetryRequestedV1,
  'ops.CompensationRequested.v1': CompensationRequestedV1,
  'payment.PaymentRefunded.v1': PaymentRefundedV1,
  'ops.DeadLetter.v1': DeadLetterV1,
};

export function createEvent<T>(
  type: EventName,
  key: string,
  payload: T,
  opts?: { correlationId?: string; causationId?: string; headers?: Record<string, string | number | boolean> }
): EventEnvelope<T> {
  const version = 1;
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const correlationId = opts?.correlationId ?? eventId;
  return {
    eventId,
    type,
    version,
    timestamp: now,
    correlationId,
    causationId: opts?.causationId,
    key,
    payload,
    headers: opts?.headers ?? {},
  };
}

export function validateEvent(envelope: EventEnvelope<any>): { ok: true } | { ok: false; error: string } {
  const schema = schemas[envelope.type as EventName];
  if (!schema) return { ok: false, error: `Unknown event type ${envelope.type}` };
  const result = schema.safeParse(envelope.payload);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true };
}

```



### libs/shared/src/kafka.ts





















































































































































































































































































































































```ts
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

```



### libs/shared/src/mongo.ts





















































































































































































































































































































































```ts
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

```



### libs/shared/src/idempotency.ts





















































































































































































































































































































































```ts
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

```



### libs/shared/src/outbox.ts





















































































































































































































































































































































```ts
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

```



### libs/shared/src/metrics.ts





















































































































































































































































































































































```ts
import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const eventsProcessed = new client.Counter({
  name: 'events_processed_total',
  help: 'Total number of events processed',
  labelNames: ['service', 'eventType', 'status'] as const,
});
register.registerMetric(eventsProcessed);

export const processingDuration = new client.Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Histogram of event processing durations',
  labelNames: ['service', 'eventType'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});
register.registerMetric(processingDuration);

export function metricsMiddleware() {
  return async (_req: any, res: any) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  };
}

```



### libs/shared/src/auth.ts





















































































































































































































































































































































```ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function jwtMiddleware(required = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: 'missing token' });
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid token' });
    }
  };
}

```



## Services — Source Overviews



### services/order-service/src/index.ts





















































































































































































































































































































































```ts
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getCollection, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency } from '@ecom/shared';
import { Db, Collection } from 'mongodb';
import { jwtMiddleware } from '@ecom/shared';
import { randomUUID } from 'crypto';

const SERVICE = process.env.SERVICE_NAME || 'order-service';
const PORT = Number(process.env.PORT || 4001);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'order_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

// Topics
const TOPICS = {
  orderCreated: 'order.OrderCreated.v1',
  inventoryReserved: 'inventory.InventoryReserved.v1',
  inventoryFailed: 'inventory.InventoryFailed.v1',
  paymentAuthorized: 'payment.PaymentAuthorized.v1',
  paymentFailed: 'payment.PaymentFailed.v1',
  orderShipped: 'shipping.OrderShipped.v1',
  shippingFailed: 'shipping.ShippingFailed.v1',
  retryRequested: 'ops.RetryRequested.v1',
  compensationRequested: 'ops.CompensationRequested.v1',
};

type OrderDoc = {
  _id: string; // orderId
  items: { sku: string; qty: number }[];
  total: number;
  status: 'CREATED' | 'INVENTORY_RESERVED' | 'INVENTORY_FAILED' | 'PAYMENT_AUTHORIZED' | 'PAYMENT_FAILED' | 'SHIPPED' | 'SHIPPING_FAILED' | 'REFUNDED';
  history: { type: string; at: Date; details?: any }[];
  createdAt: Date;
  updatedAt: Date;
  correlationId: string;
};

async function main() {
  const log = createLogger(SERVICE);
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const db: Db = await getDb(MONGO_URL, DB_NAME);
  const orders = db.collection<OrderDoc>('orders');
  const processed = db.collection<{ _id: string; consumer: string; eventId: string; at: Date }>('processed_events');

  // Outbox
  const outbox = db.collection('outbox');
  const producer = await createProducer(KAFKA_BROKERS);
  const stopOutbox = startOutboxDispatcher(outbox as any, producer);

  // Consumer: update order state from downstream events
  const consumer = await createConsumer(KAFKA_BROKERS, `${SERVICE}-group`);
  await consumer.subscribe({ topic: TOPICS.inventoryReserved, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.inventoryFailed, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.paymentAuthorized, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.paymentFailed, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.orderShipped, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.shippingFailed, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const value = message.value?.toString();
        if (!value) return;
        const evt = JSON.parse(value);
        const eventId = evt.eventId as string;
        const consumerName = `${SERVICE}-consumer`;
        const { alreadyProcessed } = await withIdempotency(processed as any, consumerName, eventId, async () => {
          const orderId = evt.payload.orderId as string;
          const now = new Date();
          const hist = { type: topic, at: now, details: evt.payload };
          switch (topic) {
            case TOPICS.inventoryReserved:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'INVENTORY_RESERVED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.inventoryFailed:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'INVENTORY_FAILED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.paymentAuthorized:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'PAYMENT_AUTHORIZED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.paymentFailed:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'PAYMENT_FAILED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.orderShipped:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'SHIPPED', updatedAt: now }, $push: { history: hist } }
              );
              break;
            case TOPICS.shippingFailed:
              await orders.updateOne(
                { _id: orderId },
                { $set: { status: 'SHIPPING_FAILED', updatedAt: now }, $push: { history: hist } }
              );
              break;
          }
        });
        if (!alreadyProcessed) {
          eventsProcessed.inc({ service: SERVICE, eventType: topic, status: 'ok' });
        }
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

  // Endpoints
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', metricsMiddleware());

  app.post('/orders', async (req, res) => {
    try {
  const { items, total, orderId } = req.body || {};
  const id = orderId || randomUUID();
      const now = new Date();
      const correlationId = id;
      await orders.insertOne({
        _id: id,
        items,
        total,
        status: 'CREATED',
        history: [{ type: 'order.created', at: now, details: { items, total } }],
        createdAt: now,
        updatedAt: now,
        correlationId,
      });
      const event = createEvent('order.OrderCreated.v1', id, { orderId: id, items, total }, { correlationId });
      await enqueueOutbox(outbox as any, 'order.OrderCreated.v1', event);
      res.status(201).json({ orderId: id });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.get('/orders/:id', async (req, res) => {
    const ord = await orders.findOne({ _id: req.params.id });
    if (!ord) return res.status(404).json({ error: 'not found' });
    res.json(ord);
  });

  // Admin operations: protected
  app.post('/admin/retry/:id', jwtMiddleware(true), async (req, res) => {
    const step = (req.body?.step || 'inventory') as 'inventory' | 'payment' | 'shipping';
    const orderId = req.params.id;
    const event = createEvent('ops.RetryRequested.v1', orderId, { orderId, step }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.RetryRequested.v1', event);
    res.json({ ok: true });
  });

  app.post('/admin/compensate/:id', jwtMiddleware(true), async (req, res) => {
    const action = (req.body?.action || 'releaseInventory') as 'releaseInventory' | 'refundPayment';
    const orderId = req.params.id;
    const event = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.CompensationRequested.v1', event);
    res.json({ ok: true });
  });

  app.listen(PORT, () => log.info({ port: PORT }, 'Order service listening'));

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

```



### services/inventory-service/src/index.ts





















































































































































































































































































































































```ts
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency } from '@ecom/shared';
import { Db } from 'mongodb';

const SERVICE = process.env.SERVICE_NAME || 'inventory-service';
const PORT = Number(process.env.PORT || 4002);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'inventory_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');

const TOPICS = {
  orderCreated: 'order.OrderCreated.v1',
  inventoryReserved: 'inventory.InventoryReserved.v1',
  inventoryFailed: 'inventory.InventoryFailed.v1',
  retryRequested: 'ops.RetryRequested.v1',
  compensationRequested: 'ops.CompensationRequested.v1',
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
  await consumer.subscribe({ topic: TOPICS.orderCreated, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.retryRequested, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.compensationRequested, fromBeginning: true });

  function simulateReserve(items: any[]): { ok: true; reservedItems: any[] } | { ok: false; reason: string } {
    // simulate 85% success
    const ok = Math.random() < 0.85;
    if (ok) return { ok: true, reservedItems: items };
    return { ok: false, reason: 'out_of_stock' };
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
          if (topic === TOPICS.orderCreated) {
            const { orderId, items } = evt.payload;
            const result = simulateReserve(items);
            if (result.ok) {
              const e = createEvent('inventory.InventoryReserved.v1', orderId, { orderId, reservedItems: result.reservedItems }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'inventory.InventoryReserved.v1', e);
            } else {
              const e = createEvent('inventory.InventoryFailed.v1', orderId, { orderId, reason: result.reason }, { correlationId: evt.correlationId, causationId: eventId });
              await enqueueOutbox(outbox as any, 'inventory.InventoryFailed.v1', e);
            }
          } else if (topic === TOPICS.retryRequested && evt.payload.step === 'inventory') {
            const { orderId } = evt.payload;
            // naive retry: emit reserved success again
            const e = createEvent('inventory.InventoryReserved.v1', orderId, { orderId, reservedItems: [] }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'inventory.InventoryReserved.v1', e);
          } else if (topic === TOPICS.compensationRequested && evt.payload.action === 'releaseInventory') {
            const { orderId } = evt.payload;
            const e = createEvent('inventory.InventoryFailed.v1', orderId, { orderId, reason: 'released' }, { correlationId: evt.correlationId, causationId: eventId });
            await enqueueOutbox(outbox as any, 'inventory.InventoryFailed.v1', e);
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

  app.listen(PORT, () => log.info({ port: PORT }, 'Inventory service listening'));

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

```



### services/payment-service/src/index.ts





















































































































































































































































































































































```ts
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

```



### services/shipping-service/src/index.ts





















































































































































































































































































































































```ts
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

```



### services/read-model-service/src/index.ts





















































































































































































































































































































































```ts
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createLogger, getDb, createProducer, createConsumer, enqueueOutbox, startOutboxDispatcher, createEvent, eventsProcessed, metricsMiddleware, withIdempotency, jwtMiddleware } from '@ecom/shared';
import { Db } from 'mongodb';

const SERVICE = process.env.SERVICE_NAME || 'read-model-service';
const PORT = Number(process.env.PORT || 4005);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'read_model_service';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const TOPICS = [
  'order.OrderCreated.v1',
  'inventory.InventoryReserved.v1',
  'inventory.InventoryFailed.v1',
  'payment.PaymentAuthorized.v1',
  'payment.PaymentFailed.v1',
  'shipping.OrderShipped.v1',
  'shipping.ShippingFailed.v1',
  'payment.PaymentRefunded.v1',
];

async function main() {
  const log = createLogger(SERVICE);
  const app = express();
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(bodyParser.json());

  const db: Db = await getDb(MONGO_URL, DB_NAME);
  const processed = db.collection<{ _id: string; consumer: string; eventId: string; at: Date }>('processed_events');
  const projections = db.collection<any>('orders_projection');

  const outbox = db.collection('outbox');
  const producer = await createProducer(KAFKA_BROKERS);
  const stopOutbox = startOutboxDispatcher(outbox as any, producer);

  const consumer = await createConsumer(KAFKA_BROKERS, `${SERVICE}-group`);
  for (const t of TOPICS) await consumer.subscribe({ topic: t, fromBeginning: true });

  type Client = { res: any };
  const sseClients: Record<string, Set<Client>> = {};

  function broadcast(orderId: string, data: any) {
    const set = sseClients[orderId];
    if (!set) return;
    for (const c of set) {
      c.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value?.toString();
      if (!value) return;
      const evt = JSON.parse(value);
      const eventId = evt.eventId as string;
      const consumerName = `${SERVICE}-consumer`;
      const { alreadyProcessed } = await withIdempotency(processed as any, consumerName, eventId, async () => {
        const orderId = evt.payload.orderId as string;
        const now = new Date();
        const statusMap: any = {
          'order.OrderCreated.v1': 'CREATED',
          'inventory.InventoryReserved.v1': 'INVENTORY_RESERVED',
          'inventory.InventoryFailed.v1': 'INVENTORY_FAILED',
          'payment.PaymentAuthorized.v1': 'PAYMENT_AUTHORIZED',
          'payment.PaymentFailed.v1': 'PAYMENT_FAILED',
          'shipping.OrderShipped.v1': 'SHIPPED',
          'shipping.ShippingFailed.v1': 'SHIPPING_FAILED',
          'payment.PaymentRefunded.v1': 'REFUNDED',
        };
        const status = statusMap[topic] || 'UNKNOWN';

        await projections.updateOne(
          { _id: orderId },
          {
            $setOnInsert: { createdAt: now },
            $set: { updatedAt: now, currentStatus: status },
            // cast to any to avoid overly strict generics from mongodb types
            $push: { timeline: { type: topic, at: now, details: evt.payload } } as any,
          },
          { upsert: true }
        );
        broadcast(orderId, { type: topic, at: now, details: evt.payload, status });
      });
      if (!alreadyProcessed) eventsProcessed.inc({ service: SERVICE, eventType: topic, status: 'ok' });
    },
  });

  // REST
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', metricsMiddleware());

  app.get('/orders', async (req, res) => {
    const status = req.query.status as string | undefined;
    const q: any = {};
    if (status) q.currentStatus = status;
    const list = await projections.find(q).sort({ updatedAt: -1 }).limit(100).toArray();
    res.json(list);
  });

  app.get('/orders/:id', async (req, res) => {
    const doc = await projections.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json(doc);
  });

  app.get('/orders/:id/stream', async (req, res) => {
    const orderId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const set = (sseClients[orderId] = sseClients[orderId] || new Set());
    const client = { res };
    set.add(client);
    req.on('close', () => {
      set.delete(client);
      if (set.size === 0) delete sseClients[orderId];
    });
  });

  // Admin: produce retry/compensation commands
  app.post('/admin/retry/:id', jwtMiddleware(true), async (req, res) => {
    const orderId = req.params.id;
    const step = (req.body?.step || 'inventory') as 'inventory' | 'payment' | 'shipping';
    const event = createEvent('ops.RetryRequested.v1', orderId, { orderId, step }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.RetryRequested.v1', event);
    res.json({ ok: true });
  });

  app.post('/admin/compensate/:id', jwtMiddleware(true), async (req, res) => {
    const orderId = req.params.id;
    const action = (req.body?.action || 'releaseInventory') as 'releaseInventory' | 'refundPayment';
    const event = createEvent('ops.CompensationRequested.v1', orderId, { orderId, action }, { correlationId: orderId });
    await enqueueOutbox(outbox as any, 'ops.CompensationRequested.v1', event);
    res.json({ ok: true });
  });

  app.listen(PORT, () => log.info({ port: PORT }, 'Read-model service listening'));

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

```



## Apps — Dashboard & Load Generator



### apps/dashboard/vite.config.ts





















































































































































































































































































































































```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  }
})

```



### apps/dashboard/src/App.tsx





















































































































































































































































































































































```tsx
import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4005'

type TimelineItem = { type: string; at: string; details?: any }

type OrderProjection = {
  _id: string
  currentStatus: string
  timeline: TimelineItem[]
}

export default function App() {
  const [orderId, setOrderId] = useState('')
  const [order, setOrder] = useState<OrderProjection | null>(null)
  const [log, setLog] = useState<TimelineItem[]>([])
  const [list, setList] = useState<OrderProjection[]>([])

  useEffect(() => {
    fetch(`${API_BASE}/orders`).then(r => r.json()).then(setList).catch(() => {})
  }, [])

  const connectSSE = (id: string) => {
    const es = new EventSource(`${API_BASE}/orders/${id}/stream`)
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      setLog(l => [...l, { type: data.type, at: new Date(data.at).toISOString(), details: data.details }])
      setOrder(prev => prev ? { ...prev, currentStatus: data.status, timeline: [...(prev.timeline||[]), { type: data.type, at: data.at, details: data.details }] } : prev)
    }
    es.onerror = () => {
      es.close()
      setTimeout(() => connectSSE(id), 1000)
    }
  }

  const onLoad = async () => {
    const doc = await fetch(`${API_BASE}/orders/${orderId}`).then(r => r.json())
    setOrder(doc)
    setLog(doc.timeline || [])
    connectSSE(orderId)
  }

  const retry = async (step: 'inventory'|'payment'|'shipping') => {
    await fetch(`${API_BASE}/admin/retry/${orderId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step }) })
  }

  const compensate = async (action: 'releaseInventory'|'refundPayment') => {
    await fetch(`${API_BASE}/admin/compensate/${orderId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <h1>Orders</h1>
      <div style={{ display: 'flex', gap: 12 }}>
        <input placeholder="Order ID" value={orderId} onChange={e => setOrderId(e.target.value)} />
        <button onClick={onLoad} disabled={!orderId}>Load</button>
        <button onClick={() => retry('inventory')} disabled={!orderId}>Retry Inventory</button>
        <button onClick={() => retry('payment')} disabled={!orderId}>Retry Payment</button>
        <button onClick={() => retry('shipping')} disabled={!orderId}>Retry Shipping</button>
        <button onClick={() => compensate('releaseInventory')} disabled={!orderId}>Release Inventory</button>
        <button onClick={() => compensate('refundPayment')} disabled={!orderId}>Refund Payment</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginTop: 20 }}>
        <div>
          <h2>Recent Orders</h2>
          <ul>
            {list.map(o => (
              <li key={o._id}>
                <button onClick={() => { setOrderId(o._id); onLoad() }}>{o._id}</button>
                <span style={{ marginLeft: 8, fontSize: 12 }}>{o.currentStatus}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Order {order?._id}</h2>
          <p>Status: <b>{order?.currentStatus}</b></p>
          <h3>Timeline</h3>
          <ul>
            {(order?.timeline || []).map((t, i) => (
              <li key={i}>{t.at} — {t.type}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

```



### apps/load-generator/index.js





















































































































































































































































































































































```js
import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';

const ORDER_SERVICE = process.env.ORDER_SERVICE || 'http://localhost:4001';
const RATE = Number(process.env.RATE || 5); // orders per second
const DURATION = Number(process.env.DURATION || 30); // seconds

function randomOrder() {
  const items = Array.from({ length: Math.ceil(Math.random() * 3) }, (_, i) => ({ sku: `SKU-${Math.ceil(Math.random()*100)}`, qty: Math.ceil(Math.random()*3) }));
  const total = items.reduce((s, it) => s + it.qty * 10, 0);
  const orderId = randomUUID();
  return { orderId, items, total };
}

async function createOrder(o) {
  try {
    const r = await fetch(`${ORDER_SERVICE}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    if (!r.ok) throw new Error(await r.text());
    console.log('created', o.orderId);
  } catch (e) {
    console.error('createOrder error', e);
  }
}

async function main() {
  const end = Date.now() + DURATION * 1000;
  while (Date.now() < end) {
    for (let i = 0; i < RATE; i++) {
      createOrder(randomOrder());
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

main();

```



## Operational Patterns

- Idempotency: consumer-level deduplication via processed_events with unique keys per (consumer,eventId).
- Outbox: reliable publish using polling dispatcher, at-least-once delivery to Kafka.
- DLQ: on consumer exceptions, serialize to ops.DeadLetter.v1 to <topic>.dlq for replay.
- Saga/Compensation: RetryRequested and CompensationRequested topics orchestrate retries and refunds/releases.


## Security & Observability

- Security: JWT middleware for admin endpoints; secrets via env.
- Observability: pino JSON logs; Prometheus metrics /metrics; health at /health.


## API & Topics Reference

- Order Service: POST /orders; GET /orders/:id
- Read Model: GET /orders, GET /orders/:id, SSE /orders/:id/stream; Admin POST /admin/retry/:id, /admin/compensate/:id
- Topics: order.OrderCreated.v1, inventory.InventoryReserved.v1, inventory.InventoryFailed.v1, payment.PaymentAuthorized.v1, payment.PaymentFailed.v1, shipping.OrderShipped.v1, shipping.ShippingFailed.v1, payment.PaymentRefunded.v1, ops.RetryRequested.v1, ops.CompensationRequested.v1, ops.DeadLetter.v1


## Troubleshooting & Future Work

- Avoid creating indexes on _id with options in Mongo; use compound indexes when needed.
- For Docker builds on Linux, keep fsevents as optionalDependency.
- Future: DLQ replayer tool, exponential backoff, richer tests, chaos engineering.


## Appendix — Dockerfiles



### services/order-service/Dockerfile





















































































































































































































































































































































```dockerfile
FROM node:20-alpine
WORKDIR /app
# copy full workspace for simplicity
COPY . .
RUN npm install && npm run build
CMD ["node", "services/order-service/dist/index.js"]

```



### services/inventory-service/Dockerfile





















































































































































































































































































































































```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "services/inventory-service/dist/index.js"]

```



### services/payment-service/Dockerfile





















































































































































































































































































































































```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "services/payment-service/dist/index.js"]

```



### services/shipping-service/Dockerfile





















































































































































































































































































































































```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "services/shipping-service/dist/index.js"]

```



### services/read-model-service/Dockerfile





















































































































































































































































































































































```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "services/read-model-service/dist/index.js"]

```



### apps/dashboard/Dockerfile





















































































































































































































































































































































```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json vite.config.ts index.html /app/
COPY src /app/src
RUN npm install
ENV VITE_API_BASE=${VITE_API_BASE}
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

```
