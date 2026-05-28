# eSueldos - Requirements del proyecto

Este documento resume los requisitos tecnicos, servicios, variables de entorno y pasos minimos para levantar el sistema completo de liquidacion de sueldos multiconvenio.

## 1. Stack principal

- Frontend estatico: HTML, CSS y JavaScript vanilla.
- Backend: Node.js + Express.
- Base de datos: MongoDB.
- IA: Gemini API para leIA, lectura de escalas PDF y estructuracion de convenios.
- Persistencia de archivos: filesystem local en `backend-esueldos-calculadoras/uploads`.

## 2. Versiones requeridas

- Node.js 18 o superior.
- npm incluido con Node.js.
- MongoDB local, Docker o MongoDB Atlas.
- Navegador moderno: Chrome, Edge, Firefox o equivalente.
- Sistema operativo soportado: Windows, macOS o Linux.

## 3. Estructura del repositorio

```text
frontend-esueldos-calculadoras/
  index.html
  styles.css
  app.js
  data.js
  server.js
  assets/

backend-esueldos-calculadoras/
  src/server.js
  src/db.js
  src/seed.js
  src/leia.js
  src/scale-ai.js
  src/convention-ai.js
  package.json
  .env.example
  uploads/
```

## 4. Frontend

El frontend no requiere librerias externas instaladas. Se sirve con un servidor Node simple incluido en el proyecto.

Comandos:

```bash
cd frontend-esueldos-calculadoras
npm start
```

Puerto por defecto:

- `http://127.0.0.1:5173`
- Si el puerto esta ocupado, el servidor intenta usar el siguiente puerto libre hasta `5193`.

Tambien puede abrirse `index.html` directamente, aunque para usar MongoDB, leIA, escalas IA y empleados conviene levantar el backend.

## 5. Backend

Dependencias npm:

| Paquete | Version declarada | Uso |
| --- | --- | --- |
| `express` | `^4.18.3` | API HTTP y servidor del frontend |
| `cors` | `^2.8.5` | Acceso del frontend a la API |
| `dotenv` | `^16.4.7` | Variables de entorno |
| `mongodb` | `^6.0.0` | Conexion y operaciones MongoDB |
| `multer` | `^2.1.1` | Upload de PDFs |
| `pdf-parse` | `^1.1.1` | Extraccion de texto desde PDF |
| `xlsx` | `^0.18.5` | Lectura auxiliar de planillas |

Comandos:

```bash
cd backend-esueldos-calculadoras
npm install
npm run seed
npm start
```

Puerto por defecto:

- `http://localhost:4100`

## 6. Variables de entorno

Crear `backend-esueldos-calculadoras/.env` a partir de `.env.example`.

```env
PORT=4100
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=esueldos_calculadoras
FRONTEND_DIR=../frontend-esueldos-calculadoras
GEMINI_API_KEY=tu_api_key_de_gemini
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.0-flash,gemini-1.5-flash
```

Notas:

- No commitear `.env` real.
- `GEMINI_API_KEY` es necesario para el chat leIA, auditoria IA, lectura de escalas y estructuracion de convenios.
- El backend tiene fallbacks locales para algunos convenios, pero la experiencia completa requiere la API key.

## 7. MongoDB

Base por defecto:

- `esueldos_calculadoras`

Colecciones usadas:

- `constants`
- `conventions`
- `legalReferences`
- `salaryScales`
- `conventionDrafts`
- `liquidations`
- `liquidationAudits`
- `employees`

Indices principales:

- Convenios por `id`.
- Escalas por `conventionId`, `period`, `status` y `approvedAt`.
- Liquidaciones por fecha y CUIL.
- Borradores de convenio por estado y fecha.
- Auditorias por convenio, periodo y fecha.

## 8. Funcionalidades cubiertas

- Liquidacion multiconvenio.
- Convenios base: UOCRA, Farmacia Mendoza y Camioneros.
- Convenios genericos estructurados por JSON.
- Carga de escalas salariales PDF.
- Lectura IA de escalas y propuesta de datos normalizados.
- Auditoria humana de escalas antes de aprobarlas.
- Escala vigente mensual basada en la ultima aprobada.
- Carga de CCT + escala para estructurar nuevos convenios.
- Auditoria de liquidaciones con leIA.
- Gestion de empleados.
- Guardado y consulta de liquidaciones.
- Exportacion JSON e impresion de recibos.

## 9. Endpoints principales

- `GET /api/health`
- `GET /api/catalog`
- `GET /api/conventions`
- `GET /api/conventions/:id`
- `GET /api/scales`
- `POST /api/scales/upload`
- `POST /api/scales/:id/approve`
- `POST /api/scales/:id/reject`
- `GET /api/convention-drafts`
- `POST /api/convention-drafts/upload`
- `POST /api/convention-drafts/:id/approve`
- `POST /api/convention-drafts/:id/reject`
- `GET /api/liquidations`
- `POST /api/liquidations`
- `POST /api/liquidations/audit`
- `GET /api/employees`
- `POST /api/employees`
- `POST /api/leia/chat`
- `POST /api/admin/seed`

## 10. Puesta en marcha local

1. Instalar Node.js 18 o superior.
2. Instalar o levantar MongoDB.
3. Crear `backend-esueldos-calculadoras/.env`.
4. Instalar dependencias del backend:

```bash
cd backend-esueldos-calculadoras
npm install
```

5. Sembrar catalogo inicial:

```bash
npm run seed
```

6. Levantar backend:

```bash
npm start
```

7. En otra terminal, levantar frontend si se desea servirlo aparte:

```bash
cd frontend-esueldos-calculadoras
npm start
```

8. Abrir:

- Backend sirviendo todo: `http://localhost:4100`
- Front separado: `http://127.0.0.1:5173`

## 11. Requisitos operativos

- Mantener MongoDB disponible antes de iniciar backend.
- Verificar que `PORT=4100` no este ocupado.
- Validar que los PDFs subidos sean legibles y no esten protegidos.
- Aprobar escalas y convenios solo despues de auditoria humana.
- Controlar normativa, actas homologadas y escalas vigentes antes de uso productivo.
- No usar liquidaciones como resultado legal definitivo sin revision profesional.

## 12. Seguridad y datos sensibles

- `.env` real no debe subirse al repositorio.
- La API key de Gemini debe rotarse si fue compartida publicamente.
- Los uploads pueden contener informacion laboral sensible; proteger backups y accesos.
- MongoDB local no debe exponerse publicamente sin autenticacion.
- En produccion, usar HTTPS, credenciales fuertes y politicas de acceso por rol.

## 13. Comandos utiles

Verificar sintaxis frontend:

```bash
cd frontend-esueldos-calculadoras
node --check app.js
node --check data.js
```

Verificar sintaxis backend:

```bash
cd backend-esueldos-calculadoras
node --check src/server.js
node --check src/leia.js
node --check src/scale-ai.js
node --check src/convention-ai.js
```

Reiniciar seed:

```bash
cd backend-esueldos-calculadoras
npm run seed
```

## 14. Criterio minimo para considerar el entorno listo

- Backend responde `GET /api/health`.
- Frontend carga sin errores de consola bloqueantes.
- MongoDB contiene convenios iniciales.
- `GET /api/catalog` devuelve constantes, convenios y referencias legales.
- Se puede seleccionar un convenio, liquidar, auditar y guardar una liquidacion.
- Se puede subir una escala PDF y dejarla pendiente de auditoria humana.
