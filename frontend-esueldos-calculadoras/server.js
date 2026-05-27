const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const ROOT = __dirname;
const HOST = process.env.HOST || "127.0.0.1";
const BASE_PORT = Number(process.env.PORT || 5173);
const MAX_PORT = BASE_PORT + 20;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, HOST);
  });
}

async function findPort() {
  for (let port = BASE_PORT; port <= MAX_PORT; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No hay puertos libres entre ${BASE_PORT} y ${MAX_PORT}.`);
}

function toFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const fullPath = path.resolve(ROOT, `.${requested}`);
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
}

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function main() {
  const port = await findPort();
  const server = http.createServer((req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      send(res, 405, "Metodo no permitido");
      return;
    }

    const filePath = toFilePath(req.url || "/");
    if (!filePath) {
      send(res, 403, "Ruta no permitida");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        send(res, 404, "Archivo no encontrado");
        return;
      }

      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store"
      });
      res.end(req.method === "HEAD" ? undefined : content);
    });
  });

  server.listen(port, HOST, () => {
    console.log(`Frontend eSueldos listo en http://${HOST}:${port}`);
    console.log("Si usas Mongo/API, levanta el backend en http://localhost:4100");
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
