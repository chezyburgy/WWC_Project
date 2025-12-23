# Quick Guide: Adding Data to MongoDB

## ✅ You now have 25 orders in your database!

---

## Method 1: MongoDB Compass (Desktop Application)

### Connection String:
```
mongodb://localhost:27017
```

### Steps:
1. Open MongoDB Compass
2. Connect using the connection string above
3. Navigate to: **read_model_service** → **orders_projection**
4. Click **"ADD DATA"** → **"Insert Document"**
5. Use the sample JSON from `mongodb-compass-sample-order.json`
6. Modify and insert

**Important:** Change the `_id` field to be unique each time!

📖 Full guide: See `MONGODB_COMPASS_GUIDE.md`

---

## Method 2: Command Line Scripts (EASIEST!)

### Quick Add (Default Values)
```bash
./add-order.sh
```
This automatically creates an order with:
- Auto-generated ID: `order-20251106-HHMMSS`
- 2 products: PRODUCT-A (qty: 3), PRODUCT-B (qty: 2)
- Total: $250
- Status: CREATED

### Custom Add (Interactive)
```bash
./add-custom-order.sh
```
This will prompt you for:
- Order ID (or auto-generate)
- Product SKUs and quantities
- Order total
- Order status

---

## Method 3: Mongo Express Web UI

1. Open browser: **http://localhost:8081**
2. Click **read_model_service**
3. Click **orders_projection**
4. Click **"+ New Document"** button
5. Paste JSON and save

---

## Method 4: Direct MongoDB Command

```bash
docker exec -i project-mongo-1 mongosh read_model_service --eval '
db.orders_projection.insertOne({
  _id: "custom-order-001",
  createdAt: new Date(),
  currentStatus: "CREATED",
  timeline: [{
    type: "order.OrderCreated.v1",
    at: new Date(),
    details: {
      orderId: "custom-order-001",
      items: [
        { sku: "LAPTOP", qty: 1 },
        { sku: "MOUSE", qty: 2 }
      ],
      total: 1500
    }
  }],
  updatedAt: new Date()
})
'
```

---

## Verify New Orders

### Check total count:
```bash
curl http://localhost:4005/orders | jq 'length'
```

### View all orders:
```bash
curl http://localhost:4005/orders | jq
```

### View in dashboard:
http://localhost:5173/dashboard

---

## Sample Order Templates

### Minimal Order
```json
{
  "_id": "order-001",
  "createdAt": { "$date": "2025-11-06T10:00:00.000Z" },
  "currentStatus": "CREATED",
  "timeline": [{
    "type": "order.OrderCreated.v1",
    "at": { "$date": "2025-11-06T10:00:00.000Z" },
    "details": {
      "orderId": "order-001",
      "items": [{ "sku": "PRODUCT-X", "qty": 5 }],
      "total": 100
    }
  }],
  "updatedAt": { "$date": "2025-11-06T10:00:00.000Z" }
}
```

### Fully Processed Order
```json
{
  "_id": "order-002",
  "createdAt": { "$date": "2025-11-06T10:00:00.000Z" },
  "currentStatus": "SHIPPED",
  "timeline": [
    {
      "type": "order.OrderCreated.v1",
      "at": { "$date": "2025-11-06T10:00:00.000Z" },
      "details": {
        "orderId": "order-002",
        "items": [{ "sku": "PHONE", "qty": 1 }],
        "total": 999
      }
    },
    {
      "type": "inventory.InventoryReserved.v1",
      "at": { "$date": "2025-11-06T10:00:05.000Z" },
      "details": {
        "orderId": "order-002",
        "reservedItems": [{ "sku": "PHONE", "qty": 1 }]
      }
    },
    {
      "type": "payment.PaymentAuthorized.v1",
      "at": { "$date": "2025-11-06T10:00:10.000Z" },
      "details": {
        "orderId": "order-002",
        "amount": 999,
        "authId": "AUTH-123"
      }
    },
    {
      "type": "shipping.OrderShipped.v1",
      "at": { "$date": "2025-11-06T10:00:15.000Z" },
      "details": {
        "orderId": "order-002",
        "carrier": "UPS",
        "trackingId": "TRACK-456"
      }
    }
  ],
  "updatedAt": { "$date": "2025-11-06T10:00:15.000Z" }
}
```

---

## Quick Test

Run this to add 5 test orders:
```bash
for i in {1..5}; do ./add-order.sh; sleep 1; done
```

Then check:
```bash
curl http://localhost:4005/orders | jq 'length'
# Should show 30 orders (25 existing + 5 new)
```

---

## Recommended Approach

**Best Option:** Use `./add-custom-order.sh` for interactive control

**Quickest:** Use `./add-order.sh` for bulk testing

**Visual:** Use Mongo Express at http://localhost:8081

**Professional:** Use MongoDB Compass desktop app (if port 27017 connects)

---
