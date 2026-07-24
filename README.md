# Calculadora de Liquidacion eSueldos

Plataforma para calcular liquidaciones de sueldos por convenio colectivo, con backend de API y frontend web independiente.

## Estructura

- `backend-esueldos-calculadoras/`: API, motores de liquidacion, catalogo y escalas.
- `frontend-esueldos-calculadoras/`: interfaz web para consultar convenios y liquidar.

## Requisitos

- Node.js 18 o superior
- npm
- MongoDB para el backend

## Ejecutar el proyecto

### Backend

```bash
cd backend-esueldos-calculadoras
npm install
npm run dev
```

### Frontend

```bash
cd frontend-esueldos-calculadoras
npm install
npm start
```

## Scripts utiles

### Backend

- `npm run dev`: inicia la API
- `npm run seed`: carga o actualiza el catalogo base
- `npm test`: ejecuta la bateria de tests

### Frontend

- `npm run build`: genera los bundles estaticos
- `npm start`: levanta el servidor web local

## Notas

- El backend y el frontend se ejecutan por separado.
- Las calculadoras pueden depender de escalas aprobadas en base de datos o de datos cargados en el catalogo local.
- Si una liquidacion no encuentra escala vigente, revisar primero el convenio, el periodo y la carga de escalas.
