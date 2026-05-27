# eSueldos backend MongoDB

API para usar MongoDB como fuente de convenios, escalas, constantes y liquidaciones guardadas.

## Requisitos

- Node.js 18 o superior.
- MongoDB local o remoto.

## Configuracion

Copiar `.env.example` a `.env` y ajustar si hace falta:

```bash
PORT=4100
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=esueldos_calculadoras
FRONTEND_DIR=../frontend-esueldos-calculadoras
GEMINI_API_KEY=tu_api_key_de_gemini
GEMINI_MODEL=gemini-2.5-flash
```

## Comandos

```bash
npm install
npm run seed
npm start
```

Al iniciar, si no hay convenios cargados, el backend siembra automaticamente desde `frontend-esueldos-calculadoras/data.js`.

## Endpoints

- `GET /api/health`
- `GET /api/catalog`
- `GET /api/conventions`
- `GET /api/conventions/:id`
- `GET /api/liquidations`
- `GET /api/liquidations/:id`
- `POST /api/liquidations`
- `POST /api/leia/chat`
- `POST /api/admin/seed`

Tambien sirve el frontend desde `http://localhost:4100`.
