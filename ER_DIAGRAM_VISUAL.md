# Visual ER Diagram - Event-Driven E-Commerce System

## Database Schema Diagram

```mermaid
erDiagram
    ORDER_SERVICE_ORDERS ||--o{ ORDER_HISTORY : contains
    ORDER_SERVICE_ORDERS ||--|| KAFKA_EVENTS : publishes
    KAFKA_EVENTS ||--o{ READ_MODEL_PROJECTION : consumed_by
    ORDER_SERVICE_ORDERS ||--o{ OUTBOX : writes
    OUTBOX ||--|| KAFKA_EVENTS : dispatches
    KAFKA_EVENTS ||--o{ PROCESSED_EVENTS : tracked_by
    
    ORDER_SERVICE_ORDERS {
        string _id PK "orderId"
        array items "sku, qty"
        number total
        enum status "CREATED|RESERVED|FAILED|etc"
        array history "event log"
        date createdAt
        date updatedAt
        string correlationId "saga trace id"
    }
    
    ORDER_HISTORY {
        string type "event type"
        date at "timestamp"
        object details "event payload"
    }
    
    READ_MODEL_PROJECTION {
        string _id PK "orderId"
        date createdAt
        string currentStatus
        array timeline "aggregated events"
        date updatedAt
    }
    
    KAFKA_EVENTS {
        string eventId PK "UUID"
        string type "order.OrderCreated.v1"
        number version
        string timestamp "ISO date"
        string correlationId "trace id"
        string causationId "parent event"
        string key "orderId - partition key"
        object payload "event data"
        object headers "metadata"
    }
    
    OUTBOX {
        objectId _id PK
        string eventId
        string type
        string topic
        string key "orderId"
        object payload
        date createdAt
        boolean dispatched
        date dispatchedAt
    }
    
    PROCESSED_EVENTS {
        string _id PK "consumer:eventId"
        string consumer "service name"
        string eventId
        date at "processed timestamp"
    }
```

## Service Architecture Diagram

```mermaid
graph TB
    subgraph Client["🖥️ Client Layer"]
        Dashboard["Dashboard<br/>(React + Vite)<br/>Port 5173"]
    end
    
    subgraph API["⚡ API Gateway Layer"]
        OrderAPI["Order Service<br/>Port 4001<br/>(Commands)"]
        ReadAPI["Read Model Service<br/>Port 4005<br/>(Queries + SSE)"]
    end
    
    subgraph Services["🔧 Domain Services"]
        InventorySvc["Inventory Service<br/>Port 4002"]
        PaymentSvc["Payment Service<br/>Port 4003"]
        ShippingSvc["Shipping Service<br/>Port 4004"]
    end
    
    subgraph EventBus["📨 Event Bus"]
        Kafka["Apache Kafka<br/>(Redpanda)<br/>Port 9092"]
        KafkaUI["Kafka UI<br/>Port 9080"]
    end
    
    subgraph Storage["💾 Storage Layer"]
        MongoDB["MongoDB 6<br/>Port 27017"]
        MongoExpress["Mongo Express<br/>Port 8081"]
    end
    
    Dashboard -->|POST /orders| OrderAPI
    Dashboard -->|GET /orders| ReadAPI
    Dashboard -->|SSE /orders/:id/stream| ReadAPI
    Dashboard -->|POST /admin/retry| OrderAPI
    Dashboard -->|POST /admin/compensate| OrderAPI
    
    OrderAPI -->|Write| MongoDB
    OrderAPI -->|Publish| Kafka
    
    ReadAPI -->|Read| MongoDB
    ReadAPI -->|Subscribe| Kafka
    
    InventorySvc -->|Subscribe| Kafka
    InventorySvc -->|Publish| Kafka
    InventorySvc -->|Write| MongoDB
    
    PaymentSvc -->|Subscribe| Kafka
    PaymentSvc -->|Publish| Kafka
    PaymentSvc -->|Write| MongoDB
    
    ShippingSvc -->|Subscribe| Kafka
    ShippingSvc -->|Publish| Kafka
    ShippingSvc -->|Write| MongoDB
    
    KafkaUI -.->|Monitor| Kafka
    MongoExpress -.->|Admin| MongoDB
    
    style Dashboard fill:#61dafb,stroke:#333,stroke-width:2px,color:#000
    style OrderAPI fill:#68a063,stroke:#333,stroke-width:2px
    style ReadAPI fill:#68a063,stroke:#333,stroke-width:2px
    style Kafka fill:#231f20,stroke:#333,stroke-width:2px,color:#fff
    style MongoDB fill:#4db33d,stroke:#333,stroke-width:2px,color:#fff
```

## Event Flow Diagram (Saga Pattern)

```mermaid
sequenceDiagram
    participant D as Dashboard
    participant O as Order Service
    participant K as Kafka
    participant I as Inventory Service
    participant P as Payment Service
    participant S as Shipping Service
    participant R as Read Model

    D->>O: POST /orders {items, total}
    O->>O: Create Order (status=CREATED)
    O->>K: order.OrderCreated.v1
    K->>R: Event consumed
    R->>R: Update projection
    
    K->>I: Event consumed
    I->>I: Reserve inventory
    I->>K: inventory.InventoryReserved.v1
    K->>R: Event consumed
    R->>R: Update timeline
    
    K->>P: Event consumed
    P->>P: Authorize payment
    P->>K: payment.PaymentAuthorized.v1
    K->>R: Event consumed
    R->>R: Update timeline
    
    K->>S: Event consumed
    S->>S: Initiate shipping
    S->>K: shipping.OrderShipped.v1
    K->>R: Event consumed
    R->>R: Update timeline (status=SHIPPED)
    
    R->>D: SSE: Real-time updates
```

## Saga Compensation Flow

```mermaid
sequenceDiagram
    participant D as Dashboard
    participant O as Order Service
    participant K as Kafka
    participant S as Shipping Service
    participant P as Payment Service
    participant I as Inventory Service
    participant R as Read Model

    Note over S: Shipping fails!
    S->>K: shipping.ShippingFailed.v1
    K->>R: Event consumed
    R->>R: Update status=SHIPPING_FAILED
    R->>D: SSE: Failure notification
    
    D->>D: User clicks "Refund Payment"
    D->>O: POST /admin/compensate/:id<br/>{action: "refundPayment"}
    O->>K: ops.CompensationRequested.v1
    
    K->>P: Event consumed
    P->>P: Process refund
    P->>K: payment.PaymentRefunded.v1
    K->>R: Event consumed
    R->>R: Update status=REFUNDED
    R->>D: SSE: Refund confirmed
    
    Note over D: Alternatively: Release Inventory
    D->>O: POST /admin/compensate/:id<br/>{action: "releaseInventory"}
    O->>K: ops.CompensationRequested.v1
    K->>I: Event consumed
    I->>I: Release reserved items
```

## Kafka Topics & Event Types

```mermaid
graph LR
    subgraph Order_Events["📦 Order Events"]
        E1["order.OrderCreated.v1"]
    end
    
    subgraph Inventory_Events["📊 Inventory Events"]
        E2["inventory.InventoryReserved.v1"]
        E3["inventory.InventoryFailed.v1"]
    end
    
    subgraph Payment_Events["💳 Payment Events"]
        E4["payment.PaymentAuthorized.v1"]
        E5["payment.PaymentFailed.v1"]
        E6["payment.PaymentRefunded.v1"]
    end
    
    subgraph Shipping_Events["🚚 Shipping Events"]
        E7["shipping.OrderShipped.v1"]
        E8["shipping.ShippingFailed.v1"]
    end
    
    subgraph Operations_Events["⚙️ Operations Events"]
        E9["ops.RetryRequested.v1"]
        E10["ops.CompensationRequested.v1"]
        E11["ops.DeadLetter.v1"]
    end
    
    style E1 fill:#4a90e2,color:#fff
    style E2 fill:#7ed321,color:#000
    style E3 fill:#d0021b,color:#fff
    style E4 fill:#7ed321,color:#000
    style E5 fill:#d0021b,color:#fff
    style E6 fill:#f5a623,color:#000
    style E7 fill:#7ed321,color:#000
    style E8 fill:#d0021b,color:#fff
    style E9 fill:#f5a623,color:#000
    style E10 fill:#f5a623,color:#000
    style E11 fill:#d0021b,color:#fff
```

## Database Collections Per Service

```mermaid
graph TD
    subgraph OrderServiceDB["🗄️ order_service DB"]
        OS1["orders<br/>(Command State)"]
        OS2["processed_events<br/>(Idempotency)"]
        OS3["outbox<br/>(Transactional)"]
    end
    
    subgraph InventoryServiceDB["🗄️ inventory_service DB"]
        IS1["processed_events"]
        IS2["outbox"]
    end
    
    subgraph PaymentServiceDB["🗄️ payment_service DB"]
        PS1["processed_events"]
        PS2["outbox"]
    end
    
    subgraph ShippingServiceDB["🗄️ shipping_service DB"]
        SS1["processed_events"]
        SS2["outbox"]
    end
    
    subgraph ReadModelServiceDB["🗄️ read_model_service DB"]
        RS1["orders_projection<br/>(Query State)"]
        RS2["processed_events"]
        RS3["outbox"]
    end
    
    style OS1 fill:#4a90e2,color:#fff
    style RS1 fill:#7ed321,color:#000
```

## Data Consistency Patterns

```mermaid
graph TB
    subgraph TransactionalOutbox["📤 Transactional Outbox Pattern"]
        T1["1. Write to DB + Outbox<br/>(Atomic Transaction)"]
        T2["2. Background Poller<br/>Reads Outbox"]
        T3["3. Publish to Kafka"]
        T4["4. Mark as Dispatched"]
        
        T1 --> T2
        T2 --> T3
        T3 --> T4
    end
    
    subgraph IdempotencyPattern["🔒 Idempotency Pattern"]
        I1["1. Receive Event<br/>(eventId: UUID)"]
        I2["2. Check processed_events"]
        I3{"Already<br/>Processed?"}
        I4["3a. Skip Processing"]
        I5["3b. Process Event"]
        I6["4. Record in<br/>processed_events"]
        
        I1 --> I2
        I2 --> I3
        I3 -->|Yes| I4
        I3 -->|No| I5
        I5 --> I6
    end
    
    style T1 fill:#4a90e2,color:#fff
    style T3 fill:#7ed321,color:#000
    style I3 fill:#f5a623,color:#000
    style I5 fill:#7ed321,color:#000
```

## Order Status State Machine

```mermaid
stateDiagram-v2
    [*] --> CREATED: Order Created
    
    CREATED --> INVENTORY_RESERVED: Inventory Reserved
    CREATED --> INVENTORY_FAILED: Inventory Failed
    
    INVENTORY_RESERVED --> PAYMENT_AUTHORIZED: Payment Authorized
    INVENTORY_RESERVED --> PAYMENT_FAILED: Payment Failed
    
    PAYMENT_AUTHORIZED --> SHIPPED: Shipping Success
    PAYMENT_AUTHORIZED --> SHIPPING_FAILED: Shipping Failed
    
    INVENTORY_FAILED --> CREATED: Retry Inventory
    PAYMENT_FAILED --> INVENTORY_RESERVED: Retry Payment
    SHIPPING_FAILED --> PAYMENT_AUTHORIZED: Retry Shipping
    
    INVENTORY_FAILED --> [*]: Cancel Order
    PAYMENT_FAILED --> INVENTORY_RELEASED: Release Inventory
    SHIPPING_FAILED --> REFUNDED: Refund Payment
    
    SHIPPED --> [*]: Order Complete
    REFUNDED --> [*]: Order Cancelled
    INVENTORY_RELEASED --> [*]: Order Cancelled
    
    note right of CREATED
        Initial state after
        POST /orders
    end note
    
    note right of SHIPPED
        Final success state
    end note
    
    note right of REFUNDED
        Compensation complete
    end note
```

