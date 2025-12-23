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
