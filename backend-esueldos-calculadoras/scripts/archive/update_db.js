const { MongoClient } = require('mongodb');
async function run() {
  const client = new MongoClient('mongodb+srv://joni:esueldos1234@cluster0.fljoqhs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
  await client.connect();
  const db = client.db('esueldos_calculadoras');
  await db.collection('conventions').updateOne(
    {'id': '26.844'}, 
    { $push: { 
        conceptos: { 
          concepto_id: 'ZONA_DESFAVORABLE', 
          nombre: 'Adicional Zona Desfavorable (Sur)', 
          porcentaje: 30, 
          tipo_concepto: 'haber', 
          naturaleza: 'remunerativo', 
          base_calculo: 'sueldo_basico', 
          condicion: 'Aplica en zona sur', 
          es_liquidable: true, 
          formula_base: 'porcentaje_sobre_base', 
          calculation: 'percentofbase' 
        } 
      } 
    }
  );
  console.log('Update complete');
  await client.close();
}
run();
