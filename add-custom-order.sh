#!/bin/bash

# Interactive script to add custom orders to MongoDB
# Usage: ./add-custom-order.sh

echo "================================================"
echo "   Add Custom Order to MongoDB"
echo "================================================"
echo ""

# Get order details from user
read -p "Enter Order ID (or press Enter for auto-generated): " ORDER_ID
if [ -z "$ORDER_ID" ]; then
  ORDER_ID="order-$(date +%Y%m%d-%H%M%S)"
  echo "Generated Order ID: $ORDER_ID"
fi

echo ""
read -p "Enter first product SKU (e.g., LAPTOP-001): " SKU1
read -p "Enter quantity for $SKU1: " QTY1

read -p "Enter second product SKU (or press Enter to skip): " SKU2
if [ -n "$SKU2" ]; then
  read -p "Enter quantity for $SKU2: " QTY2
fi

echo ""
read -p "Enter total order amount: " TOTAL

echo ""
read -p "Enter order status (CREATED/SHIPPED/DELIVERED) [CREATED]: " STATUS
STATUS=${STATUS:-CREATED}

# Generate timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo ""
echo "Creating order with following details:"
echo "  Order ID: $ORDER_ID"
echo "  Status: $STATUS"
echo "  Items: $SKU1 (qty: $QTY1)"
[ -n "$SKU2" ] && echo "         $SKU2 (qty: $QTY2)"
echo "  Total: $TOTAL"
echo ""
read -p "Proceed? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
  echo "Cancelled."
  exit 0
fi

# Build items array
if [ -n "$SKU2" ]; then
  ITEMS="{ sku: '$SKU1', qty: $QTY1 }, { sku: '$SKU2', qty: $QTY2 }"
else
  ITEMS="{ sku: '$SKU1', qty: $QTY1 }"
fi

# Insert the order
docker exec -i project-mongo-1 mongosh read_model_service --quiet --eval "
db.orders_projection.insertOne({
  _id: '$ORDER_ID',
  createdAt: new Date('$TIMESTAMP'),
  currentStatus: '$STATUS',
  timeline: [
    {
      type: 'order.OrderCreated.v1',
      at: new Date('$TIMESTAMP'),
      details: {
        orderId: '$ORDER_ID',
        items: [$ITEMS],
        total: $TOTAL
      }
    }
  ],
  updatedAt: new Date('$TIMESTAMP')
})
"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Order added successfully!"
  echo ""
  echo "Total orders in database:"
  docker exec -i project-mongo-1 mongosh read_model_service --quiet --eval "db.orders_projection.countDocuments()"
  echo ""
  echo "View in dashboard: http://localhost:5173/dashboard"
  echo "View in Mongo Express: http://localhost:8081"
else
  echo ""
  echo "❌ Error adding order. Check the error message above."
fi
