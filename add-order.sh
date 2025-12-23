#!/bin/bash

# Script to add a new order directly to MongoDB
# Usage: ./add-order.sh

# Generate a unique order ID
ORDER_ID="order-$(date +%Y%m%d-%H%M%S)"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "Adding new order with ID: $ORDER_ID"

# Create the order document
docker exec -i project-mongo-1 mongosh read_model_service --quiet --eval "
db.orders_projection.insertOne({
  _id: '$ORDER_ID',
  createdAt: new Date('$TIMESTAMP'),
  currentStatus: 'CREATED',
  timeline: [
    {
      type: 'order.OrderCreated.v1',
      at: new Date('$TIMESTAMP'),
      details: {
        orderId: '$ORDER_ID',
        items: [
          { sku: 'PRODUCT-A', qty: 3 },
          { sku: 'PRODUCT-B', qty: 2 }
        ],
        total: 250
      }
    }
  ],
  updatedAt: new Date('$TIMESTAMP')
})
"

echo ""
echo "✅ Order added successfully!"
echo "Order ID: $ORDER_ID"
echo ""
echo "Verifying order count..."
docker exec -i project-mongo-1 mongosh read_model_service --quiet --eval "db.orders_projection.countDocuments()"
echo ""
echo "Check your dashboard at: http://localhost:5173/dashboard"
