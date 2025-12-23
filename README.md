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

