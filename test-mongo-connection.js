// Test MongoDB connection from host
const { MongoClient } = require('mongodb');

async function testConnection() {
  const url = 'mongodb://localhost:27017';
  const client = new MongoClient(url);

  try {
    await client.connect();
    console.log('✅ Connected successfully to MongoDB');

    const db = client.db('read_model_service');
    const collection = db.collection('orders_projection');
    
    const count = await collection.countDocuments();
    console.log(`📊 Found ${count} orders in orders_projection collection`);

    if (count > 0) {
      const sample = await collection.findOne();
      console.log('\n📄 Sample order:');
      console.log(JSON.stringify(sample, null, 2));
    }

    // List all databases
    const adminDb = client.db('admin');
    const dbs = await adminDb.admin().listDatabases();
    console.log('\n📚 Available databases:');
    dbs.databases.forEach(db => {
      console.log(`  - ${db.name} (${(db.sizeOnDisk / 1024).toFixed(2)} KB)`);
    });

  } catch (err) {
    console.error('❌ Connection error:', err.message);
  } finally {
    await client.close();
  }
}

testConnection();
