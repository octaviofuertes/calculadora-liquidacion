# Operacion eSueldos

## Setup local

1. Levantar MongoDB local o configurar `MONGODB_URI`.
2. Copiar `.env.example` a `.env`.
3. Ejecutar `npm install`.
4. Ejecutar `npm run seed`.
5. Ejecutar `npm test`.
6. Ejecutar `npm start` y abrir `http://localhost:4100`.

## Fuente de verdad

La fuente inicial versionable vive en `src/catalog`. El seed carga esos JSON a MongoDB. El frontend consume `/api/catalog` y solo usa `data.js` como fallback offline. Las liquidaciones nuevas deben calcularse con `POST /api/liquidations/calculate`.

## Aprobacion de convenios

Un convenio generado por leIA queda como `PENDIENTE_REVISION`. Antes de aprobar:

- Validar categorias e importes contra PDF.
- Validar reglas de antiguedad, presentismo, jornada y horas extra.
- Validar conceptos no remunerativos y bases de obra social/sindicato.
- Completar `auditNote` si hubo correcciones manuales.

## Aprobacion de escalas

Una escala subida queda `PENDIENTE_REVISION`. Antes de aprobar:

- Confirmar periodo de vigencia.
- Confirmar categorias y zonas.
- Confirmar importes remunerativos/no remunerativos.
- Revisar warnings de IA.

## Criterios de auditoria de liquidacion

- Totales internos deben coincidir con filas.
- Debe existir escala aprobada vigente para el periodo si el convenio depende de escala mensual.
- Trabajador debe tener nombre, CUIL y fecha de ingreso.
- Aportes obligatorios deben existir cuando hay remunerativos.
- Conceptos manuales deben tener respaldo documental.
