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
CORS_ORIGIN=http://localhost:4100,http://127.0.0.1:5173
API_AUTH_TOKEN=
AUTH_REQUIRED=false
AUTH_JWT_SECRET=cambiar_este_secreto_en_produccion
```

## Comandos

```bash
npm install
npm run seed
npm test
npm start
```

Al iniciar, si no hay convenios cargados, el backend siembra automaticamente desde `src/catalog`. El frontend mantiene `data.js` solo como fallback offline.

## Flujo operativo

1. Cargar o aprobar convenios desde `POST /api/convention-drafts/upload`.
2. Revisar el JSON generado y aprobarlo con `POST /api/convention-drafts/:id/approve`.
3. Cargar escalas por periodo desde `POST /api/scales/upload`.
4. Revisar la extraccion y aprobar con `POST /api/scales/:id/approve`.
5. Calcular liquidaciones con `POST /api/liquidations/calculate`.
6. Guardar solo liquidaciones ya calculadas/validadas con `POST /api/liquidations`.

Cada convenio sembrado incluye `regulatoryMetadata` y las constantes incluyen `normativeVersions` con `validFrom`, `validTo`, `source`, `approvedBy` y `approvedAt`.

## Auditoria y seguridad

- `helmet` activo con CSP deshabilitado para no romper el frontend estatico actual.
- CORS configurable mediante `CORS_ORIGIN`.
- Rate limit configurable con `RATE_LIMIT_*`.
- Auth real por usuarios y roles con JWT. Si `AUTH_REQUIRED=true`, las mutaciones requieren `Authorization: Bearer <token>`.
- Bootstrap inicial: `POST /api/auth/bootstrap-admin` crea el primer admin si no existen usuarios.
- Busquedas por nombre escapan regex de usuario.
- Las cargas de PDF quedan en `uploads/`, excluido por `.gitignore`.
- `xlsx` fue removido del backend por vulnerabilidades sin fix; las exportaciones del frontend usan CSV.

## Endpoints

- `GET /api/health`
- `GET /api/catalog`
- `GET /api/conventions`
- `GET /api/conventions/:id`
- `GET /api/liquidations`
- `GET /api/liquidations/:id`
- `POST /api/liquidations/calculate`
- `POST /api/liquidations`
- `POST /api/auth/bootstrap-admin`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/users`
- `GET /api/employees`
- `POST /api/employees`
- `POST /api/leia/chat`
- `POST /api/leia/audit-liquidation`
- `POST /api/scales/upload`
- `POST /api/convention-drafts/upload`
- `POST /api/admin/seed`

Tambien sirve el frontend desde `http://localhost:4100`.
