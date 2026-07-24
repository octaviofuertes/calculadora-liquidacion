const { MongoClient } = require('mongodb');
require('dotenv').config();
MongoClient.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017').then(async client => {
  const db = client.db(process.env.DB_NAME || 'esueldos_calculadoras');
  const docs = await db.collection('conventions').find({}).project({ _id:1, id:1, name:1 }).toArray();
  console.log('Conventions in DB:', docs.length);
  docs.forEach(d => console.log(' -', d.id || d._id, '|', d.name));
  client.close();
}).catch(e => console.error(e));
