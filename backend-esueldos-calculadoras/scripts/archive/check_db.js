const { MongoClient } = require('mongodb');
async function run() {
  const uri = 'mongodb+srv://joni:esueldos1234@cluster0.fljoqhs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('esueldos_calculadoras');
  
  const allIds = await db.collection('conventions').find({}, { projection: { id: 1, 'convenio.convenio_id': 1 } }).toArray();
  console.log('All DB Conventions:', allIds);

  await client.close();
}
run().catch(console.error);
