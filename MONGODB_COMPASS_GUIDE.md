# MongoDB Compass - Adding Data Guide

## Connection Details

**Connection String:**
```
mongodb://localhost:27017
```

**Alternative (if localhost doesn't work):**
```
mongodb://127.0.0.1:27017
```

---

## Step-by-Step Instructions to Add Data via MongoDB Compass

### 1. Connect to MongoDB
1. Open **MongoDB Compass**
2. In the connection string field, enter: `mongodb://localhost:27017`
3. Click **Connect**

### 2. Navigate to the Database
1. In the left sidebar, you'll see a list of databases
2. Click on **`read_model_service`** database
3. Click on **`orders_projection`** collection

### 3. Add New Order Document

**Option A: Using the Insert Document Button**
1. Click the green **"ADD DATA"** button at the top
2. Select **"Insert Document"**
3. Copy and paste the JSON from `mongodb-compass-sample-order.json`
4. Modify the values:
   - Change `_id` to a unique value (e.g., `"order-2025-001"`)
   - Update the `orderId` in the details section to match the `_id`
   - Modify SKU values, quantities, and totals as needed
5. Click **Insert**

**Option B: Using Import JSON**
1. Click the green **"ADD DATA"** button
2. Select **"Import JSON or CSV file"**
3. Browse and select `mongodb-compass-sample-order.json`
4. Click **Import**

---

## Sample Order Template (Copy & Modify)

### Minimal Order (Just Created)
```json
{
  "_id": "order-manual-001",
  "createdAt": {
    "$date": "2025-11-06T08:30:00.000Z"
  },
  "currentStatus": "CREATED",
  "timeline": [
    {
      "type": "order.OrderCreated.v1",
      "at": {
        "$date": "2025-11-06T08:30:00.000Z"
      },
      "details": {
        "orderId": "order-manual-001",
        "items": [
          { "sku": "LAPTOP-X1", "qty": 2 },
          { "sku": "MOUSE-Y2", "qty": 5 }
        ],
        "total": 2500
      }
    }
  ],
  "updatedAt": {
    "$date": "2025-11-06T08:30:00.000Z"
  }
}
```

### Complete Order (All Stages)
```json
{
  "_id": "order-manual-002",
  "createdAt": {
    "$date": "2025-11-06T09:00:00.000Z"
  },
  "currentStatus": "SHIPPED",
  "timeline": [
    {
      "type": "order.OrderCreated.v1",
      "at": {
        "$date": "2025-11-06T09:00:00.000Z"
      },
      "details": {
        "orderId": "order-manual-002",
        "items": [
          { "sku": "PHONE-A1", "qty": 1 },
          { "sku": "CASE-B2", "qty": 2 }
        ],
        "total": 899
      }
    },
    {
      "type": "inventory.InventoryReserved.v1",
      "at": {
        "$date": "2025-11-06T09:00:05.000Z"
      },
      "details": {
        "orderId": "order-manual-002",
        "reservedItems": [
          { "sku": "PHONE-A1", "qty": 1 },
          { "sku": "CASE-B2", "qty": 2 }
        ]
      }
    },
    {
      "type": "payment.PaymentAuthorized.v1",
      "at": {
        "$date": "2025-11-06T09:00:10.000Z"
      },
      "details": {
        "orderId": "order-manual-002",
        "amount": 899,
        "authId": "AUTH-12345"
      }
    },
    {
      "type": "shipping.OrderShipped.v1",
      "at": {
        "$date": "2025-11-06T09:00:15.000Z"
      },
      "details": {
        "orderId": "order-manual-002",
        "carrier": "FedEx",
        "trackingId": "TRACK-9876543"
      }
    }
  ],
  "updatedAt": {
    "$date": "2025-11-06T09:00:15.000Z"
  }
}
```

---

## Order Status Values
- `CREATED` - Order just created
- `INVENTORY_RESERVED` - Inventory has been reserved
- `PAYMENT_AUTHORIZED` - Payment successful
- `SHIPPED` - Order has been shipped
- `DELIVERED` - Order delivered (if you want to add this status)

---

## Important Fields to Customize

1. **`_id`** - Must be unique! Use format like:
   - `order-manual-001`
   - `order-2025-11-06-001`
   - Any unique string

2. **`orderId` in details** - Must match the `_id` value

3. **`items` array** - Add your products:
   ```json
   { "sku": "YOUR-PRODUCT-SKU", "qty": 5 }
   ```

4. **`total`** - Order total amount (number)

5. **Dates** - Use format: `{ "$date": "2025-11-06T10:30:00.000Z" }`

---

## Verify Data Appears on Dashboard

After adding orders in MongoDB Compass:

1. Open your dashboard: http://localhost:5173/dashboard
2. The new orders should appear automatically
3. If not visible, refresh the page

Or check via API:
```bash
curl http://localhost:4005/orders | jq 'length'
```

---

## Troubleshooting

### MongoDB Compass Won't Connect
- Try alternative connection string: `mongodb://127.0.0.1:27017`
- Verify MongoDB is running: `docker ps | grep mongo`
- Use Mongo Express instead: http://localhost:8081

### Data Not Appearing on Dashboard
- Check API: `curl http://localhost:4005/orders`
- Verify you inserted into correct database: `read_model_service`
- Verify collection name: `orders_projection`
- Refresh the dashboard page

### Need More Examples
Run this command to see existing orders:
```bash
docker exec -it project-mongo-1 mongosh read_model_service --eval "db.orders_projection.find().pretty()"
```

---

## Quick Test - Add an Order Right Now

1. Open MongoDB Compass → Connect to `mongodb://localhost:27017`
2. Navigate to `read_model_service` → `orders_projection`
3. Click "ADD DATA" → "Insert Document"
4. Paste this:
```json
{
  "_id": "test-order-001",
  "createdAt": { "$date": "2025-11-06T10:00:00.000Z" },
  "currentStatus": "CREATED",
  "timeline": [
    {
      "type": "order.OrderCreated.v1",
      "at": { "$date": "2025-11-06T10:00:00.000Z" },
      "details": {
        "orderId": "test-order-001",
        "items": [{ "sku": "TEST-SKU", "qty": 10 }],
        "total": 100
      }
    }
  ],
  "updatedAt": { "$date": "2025-11-06T10:00:00.000Z" }
}
```
5. Click **Insert**
6. Check your dashboard - you should now see 25 orders!

---
