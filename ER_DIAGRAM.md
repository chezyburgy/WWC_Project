# Entity-Relationship Diagram (ER Diagram)

## Event-Driven E-Commerce System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE: order_service                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                          COLLECTION: orders                               │
├──────────────────────────────────────────────────────────────────────────┤
│  _id                  : string (PK) [orderId]                            │
│  items                : Array<{sku: string, qty: number}>                │
│  total                : number                                           │
│  status               : enum ['CREATED', 'INVENTORY_RESERVED',           │
│                                'INVENTORY_FAILED', 'PAYMENT_AUTHORIZED', │
│                                'PAYMENT_FAILED', 'SHIPPED',              │
│                                'SHIPPING_FAILED', 'REFUNDED']            │
│  history              : Array<{type: string, at: Date, details?: any}>  │
│  createdAt            : Date                                             │
│  updatedAt            : Date                                             │
│  correlationId        : string                                           │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ publishes events to
                                    ▼
                            ┌───────────────┐
                            │  KAFKA TOPICS │
                            └───────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATABASE: read_model_service                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    COLLECTION: orders_projection                          │
├──────────────────────────────────────────────────────────────────────────┤
│  _id                  : string (PK) [orderId]                            │
│  createdAt            : Date                                             │
│  currentStatus        : string                                           │
│  timeline             : Array<{                                          │
│                           type: string,                                  │
│                           at: Date,                                      │
│                           details: {                                     │
│                             orderId: string,                             │
│                             items?: Array<{sku: string, qty: number}>,   │
│                             total?: number,                              │
│                             reservedItems?: Array<>,                     │
│                             reason?: string,                             │
│                             amount?: number,                             │
│                             authId?: string,                             │
│                             carrier?: string,                            │
│                             trackingId?: string,                         │
│                             refundId?: string                            │
│                           }                                              │
│                         }>                                               │
│  updatedAt            : Date                                             │
└──────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│             SHARED COLLECTIONS (All Service Databases)                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                      COLLECTION: processed_events                         │
│                    (Idempotency & Deduplication)                         │
├──────────────────────────────────────────────────────────────────────────┤
│  _id                  : string (PK) [consumer:eventId]                   │
│  consumer             : string                                           │
│  eventId              : string                                           │
│  at                   : Date                                             │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                         COLLECTION: outbox                                │
│                   (Transactional Outbox Pattern)                         │
├──────────────────────────────────────────────────────────────────────────┤
│  _id                  : ObjectId (PK)                                    │
│  eventId              : string                                           │
│  type                 : string                                           │
│  topic                : string                                           │
│  key                  : string [orderId for partitioning]               │
│  payload              : object                                           │
│  createdAt            : Date                                             │
│  dispatched           : boolean                                          │
│  dispatchedAt         : Date (nullable)                                  │
└──────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                        KAFKA EVENT ENVELOPE SCHEMA                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                       EventEnvelope<T>                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  eventId              : string (UUID) [for idempotency]                  │
│  type                 : EventName (e.g., 'order.OrderCreated.v1')       │
│  version              : number                                           │
│  timestamp            : string (ISO Date)                                │
│  correlationId        : string [saga/trace ID]                           │
│  causationId          : string (optional) [caused by eventId]           │
│  key                  : string [orderId - partition key]                │
│  payload              : T [event-specific payload]                       │
│  headers              : Record<string, string|number|boolean> (optional) │
└──────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                          KAFKA TOPICS & PAYLOADS                             │
└─────────────────────────────────────────────────────────────────────────────┘

order.OrderCreated.v1
├─ orderId: string
├─ items: Array<{sku: string, qty: number}>
└─ total: number

inventory.InventoryReserved.v1
├─ orderId: string
└─ reservedItems: Array<{sku: string, qty: number}>

inventory.InventoryFailed.v1
├─ orderId: string
└─ reason: string

payment.PaymentAuthorized.v1
├─ orderId: string
├─ amount: number
└─ authId: string

payment.PaymentFailed.v1
├─ orderId: string
└─ reason: string

shipping.OrderShipped.v1
├─ orderId: string
├─ carrier: string
└─ trackingId: string

shipping.ShippingFailed.v1
├─ orderId: string
└─ reason: string

payment.PaymentRefunded.v1
├─ orderId: string
├─ amount: number
└─ refundId: string

ops.RetryRequested.v1
├─ orderId: string
└─ step: enum ['inventory', 'payment', 'shipping']

ops.CompensationRequested.v1
├─ orderId: string
└─ action: enum ['releaseInventory', 'refundPayment']

ops.DeadLetter.v1
├─ originalType: string
├─ originalEventId: string
├─ orderId: string (optional)
├─ error: string
└─ payload: any


┌─────────────────────────────────────────────────────────────────────────────┐
│                        SERVICE DATA BOUNDARIES                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
│  order_service DB   │        │ inventory_service   │        │  payment_service    │
│  (Port 4001)        │        │      (Port 4002)    │        │    (Port 4003)      │
├─────────────────────┤        ├─────────────────────┤        ├─────────────────────┤
│ • orders            │        │ • processed_events  │        │ • processed_events  │
│ • processed_events  │        │ • outbox            │        │ • outbox            │
│ • outbox            │        │                     │        │                     │
└─────────────────────┘        └─────────────────────┘        └─────────────────────┘

┌─────────────────────┐        ┌─────────────────────────────────────────────────┐
│ shipping_service    │        │       read_model_service (Port 4005)            │
│   (Port 4004)       │        │          [Query-side Projection]                │
├─────────────────────┤        ├─────────────────────────────────────────────────┤
│ • processed_events  │        │ • orders_projection                             │
│ • outbox            │        │ • processed_events                              │
│                     │        │ • outbox                                        │
└─────────────────────┘        └─────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                           EVENT FLOW DIAGRAM                                 │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────┐
    │   CLIENT    │
    │ (Dashboard) │
    └──────┬──────┘
           │ POST /orders
           ▼
    ┌─────────────────┐
    │  Order Service  │──────► order.OrderCreated.v1
    │   (Port 4001)   │
    └─────────────────┘
           │
           ├──────────────────────────────────────┐
           │                                       │
           ▼                                       ▼
    ┌─────────────────┐                   ┌──────────────────┐
    │ Read Model Svc  │◄──────────────────│ Inventory Svc    │
    │   (Port 4005)   │                   │   (Port 4002)    │
    │  [PROJECTION]   │                   └────────┬─────────┘
    └─────────────────┘                            │
           ▲                    inventory.InventoryReserved.v1
           │                                       │
           │                                       ▼
           │                            ┌──────────────────┐
           ├────────────────────────────│  Payment Svc     │
           │                            │   (Port 4003)    │
           │                            └────────┬─────────┘
           │                                     │
           │              payment.PaymentAuthorized.v1
           │                                     │
           │                                     ▼
           │                            ┌──────────────────┐
           └────────────────────────────│  Shipping Svc    │
                                        │   (Port 4004)    │
                                        └──────────────────┘
                                                 │
                                shipping.OrderShipped.v1
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  Read Model Svc  │
                                        │  [Final Update]  │
                                        └──────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                     SAGA COMPENSATION PATTERN                                │
└─────────────────────────────────────────────────────────────────────────────┘

FAILURE SCENARIO:
    
    ┌──────────────────┐
    │ shipping.Failed  │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────────┐
    │ ops.CompensationReq  │ ◄── Dashboard triggers
    │ action: refundPayment│
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │  Payment Service     │──────► payment.PaymentRefunded.v1
    │  (Compensation)      │
    └──────────────────────┘

RETRY SCENARIO:

    ┌──────────────────┐
    │ inventory.Failed │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────────┐
    │ ops.RetryRequested   │ ◄── Dashboard triggers
    │ step: inventory      │
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │  Inventory Service   │──────► inventory.InventoryReserved.v1
    │  (Retry Logic)       │
    └──────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA CONSISTENCY PATTERNS                            │
└─────────────────────────────────────────────────────────────────────────────┘

1. TRANSACTIONAL OUTBOX PATTERN
   - Events written to local `outbox` collection atomically with state changes
   - Background dispatcher polls outbox and publishes to Kafka
   - Ensures at-least-once delivery

2. IDEMPOTENCY PATTERN
   - Every event has unique `eventId`
   - `processed_events` collection tracks consumed event IDs
   - Duplicate events are ignored (exactly-once semantics)

3. EVENT SOURCING
   - Order history stored as immutable event log
   - State reconstructed from events
   - Audit trail and time-travel queries possible

4. CQRS (Command Query Responsibility Segregation)
   - Command Side: order-service, inventory-service, payment-service, shipping-service
   - Query Side: read-model-service (optimized projections for dashboard)
   - Eventual consistency between write and read models


┌─────────────────────────────────────────────────────────────────────────────┐
│                            RELATIONSHIPS                                     │
└─────────────────────────────────────────────────────────────────────────────┘

orders (order_service) ──[1:N]── history events
                           │
                           └──[correlationId]──► Kafka Topics
                                                       │
                                                       └──[consumed by]──► orders_projection

outbox ──[dispatches to]──► Kafka Topics

processed_events ──[ensures idempotency of]──► Event Consumers

orders_projection.timeline ──[aggregates from]──► Multiple Kafka Topics


┌─────────────────────────────────────────────────────────────────────────────┐
│                          KEY RELATIONSHIPS                                   │
└─────────────────────────────────────────────────────────────────────────────┘

• One Order can have multiple History Events (1:N)
• One Order creates multiple Domain Events across Topics (1:N)
• One orderId (partition key) ensures ordering in Kafka
• Multiple Services consume same events (fan-out)
• One Read Model Projection aggregates from multiple Topics (N:1)
• One Event can be processed by multiple Consumers (via consumer groups)
• Outbox ensures transactional event publishing (1:N dispatches)
```

## Architecture Notes

### Database Per Service Pattern
Each microservice has its own MongoDB database:
- **order_service**: Command-side order state
- **inventory_service**: Inventory reservations (state not shown, events-only)
- **payment_service**: Payment authorizations (state not shown, events-only)
- **shipping_service**: Shipping records (state not shown, events-only)
- **read_model_service**: Query-optimized projections for dashboard

### Event-Driven Communication
- All inter-service communication via Kafka events
- No direct service-to-service API calls
- Loose coupling, high scalability
- Partition by `orderId` for ordering guarantees

### Consistency Guarantees
- **Strong consistency** within service boundary (MongoDB transactions)
- **Eventual consistency** across services (event propagation)
- **Exactly-once semantics** via idempotency tracking
- **At-least-once delivery** via transactional outbox

### Observability
- All services log to stdout (JSON via pino)
- Prometheus metrics exposed on `/metrics`
- Health checks on `/health`
- Dashboard provides real-time SSE stream of order events
