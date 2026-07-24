#!/usr/bin/env node
/**
 * rag-manager.js — Gestor de base de conocimiento RAG para el estructurador de convenios
 *
 * Uso:
 *   node scripts/rag-manager.js create   [storeId] [displayName]
 *   node scripts/rag-manager.js list
 *   node scripts/rag-manager.js upload   <ruta-archivo> [storeId] [--department=X] [--topic=X] [--version=X]
 *   node scripts/rag-manager.js listfiles [storeId]
 *
 * Ejemplos:
 *   node scripts/rag-manager.js create convenios-arg "Conocimiento Liquidación Argentina"
 *   node scripts/rag-manager.js upload docs/ley-contrato-trabajo.pdf convenios-arg --topic=LCT --department=legal
 *   node scripts/rag-manager.js list
 */

require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const path = require("path");
const fs = require("fs");

const apiKey = process.env.GEMINI_CONVENTION_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("[RAG] Error: falta GEMINI_CONVENTION_API_KEY o GEMINI_API_KEY en el .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const positional = [];
  const flags = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      flags[key] = val ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

async function cmdCreate({ positional }) {
  const storeId = positional[0] || "convenios-argentina";
  const displayName = positional[1] || "Base de Conocimiento - Convenios Argentina";
  console.log(`[RAG] Creando almacén '${storeId}' con displayName='${displayName}'...`);
  const store = await ai.fileSearchStores.create({
    fileSearchStoreId: storeId,
    displayName
  });
  console.log(`[RAG] Almacén creado exitosamente:`);
  console.log(`  name:        ${store.name}`);
  console.log(`  displayName: ${store.displayName}`);
  console.log(`\n  Agrega en tu .env:`);
  console.log(`  GEMINI_RAG_STORE_NAME=${store.name}`);
}

async function cmdList() {
  console.log("[RAG] Listando almacenes de conocimiento...");
  const response = await ai.fileSearchStores.list();
  const stores = response.fileSearchStores || [];
  if (!stores.length) {
    console.log("[RAG] No hay almacenes. Usa 'create' para crear uno.");
    return;
  }
  console.log(`[RAG] ${stores.length} almacén(es) encontrado(s):`);
  for (const s of stores) {
    console.log(`  - ${s.name} (${s.displayName || "sin displayName"})`);
  }
}

async function cmdUpload({ positional, flags }) {
  const filePath = positional[0];
  const storeId = positional[1];

  if (!filePath) {
    console.error("[RAG] Error: especifica la ruta del archivo. Ej: node rag-manager.js upload docs/manual.pdf mi-almacen");
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`[RAG] Error: el archivo no existe: ${absolutePath}`);
    process.exit(1);
  }

  const fileExt = path.extname(absolutePath).toLowerCase();
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  const mimeType = mimeTypes[fileExt] || "application/octet-stream";

  // Determinar el almacén destino
  let storeName = process.env.GEMINI_RAG_STORE_NAME;
  if (storeId && !storeId.startsWith("--")) {
    storeName = storeId.includes("/") ? storeId : `fileSearchStores/${storeId}`;
  }
  if (!storeName) {
    console.error("[RAG] Error: especifica el almacén (2do argumento) o configura GEMINI_RAG_STORE_NAME en .env");
    process.exit(1);
  }

  const displayName = path.basename(absolutePath);
  const metadata = {};
  if (flags.department) metadata.department = flags.department;
  if (flags.topic) metadata.topic = flags.topic;
  if (flags.version) metadata.version = flags.version;
  if (flags.actividad) metadata.actividad = flags.actividad;

  console.log(`[RAG] Subiendo archivo: ${displayName}`);
  console.log(`[RAG] Almacén destino: ${storeName}`);
  console.log(`[RAG] Metadatos: ${JSON.stringify(metadata)}`);

  const fileBuffer = fs.readFileSync(absolutePath);
  const fileBlob = new Blob([fileBuffer], { type: mimeType });

  const uploadConfig = {
    displayName,
    fileSearchStoreName: storeName
  };
  if (Object.keys(metadata).length) {
    uploadConfig.metadata = metadata;
  }

  const uploadedFile = await ai.files.upload({
    file: fileBlob,
    config: uploadConfig
  });

  console.log(`[RAG] ✅ Archivo indexado con éxito:`);
  console.log(`  name:   ${uploadedFile.name}`);
  console.log(`  uri:    ${uploadedFile.uri}`);
  console.log(`  state:  ${uploadedFile.state}`);
  console.log(`  store:  ${storeName}`);

  // Esperar a que quede ACTIVE
  if (uploadedFile.state === "PROCESSING") {
    console.log("[RAG] El archivo está siendo procesado (indexado)...");
    let current = uploadedFile;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      current = await ai.files.get({ name: current.name });
      console.log(`[RAG] Estado actual: ${current.state}`);
      if (current.state === "ACTIVE") break;
      if (current.state === "FAILED") {
        console.error("[RAG] ❌ El archivo falló durante el indexado.");
        process.exit(1);
      }
    }
    console.log("[RAG] ✅ Archivo ACTIVE en el almacén. Listo para usarse.");
  }
}

async function cmdListFiles({ positional }) {
  const storeId = positional[0];
  const storeName = storeId
    ? (storeId.includes("/") ? storeId : `fileSearchStores/${storeId}`)
    : process.env.GEMINI_RAG_STORE_NAME;

  if (!storeName) {
    console.error("[RAG] Error: especifica el almacén o configura GEMINI_RAG_STORE_NAME en .env");
    process.exit(1);
  }

  console.log(`[RAG] Archivos en ${storeName}:`);
  const response = await ai.fileSearchStores.get({ name: storeName });
  console.log(JSON.stringify(response, null, 2));
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  switch (command) {
    case "create":
      await cmdCreate({ positional, flags });
      break;
    case "list":
      await cmdList();
      break;
    case "upload":
      await cmdUpload({ positional, flags });
      break;
    case "listfiles":
      await cmdListFiles({ positional, flags });
      break;
    default:
      console.log(`
[RAG] Comandos disponibles:
  create   [storeId] [displayName]   — Crear un nuevo almacén RAG
  list                               — Listar todos los almacenes
  upload   <archivo> [storeId]       — Subir e indexar un archivo
             --department=X         — Metadato: departamento/area
             --topic=X              — Metadato: tema
             --version=X            — Metadato: version del documento
             --actividad=X          — Metadato: rama o actividad
  listfiles [storeId]               — Listar archivos en un almacén

Ejemplos:
  node scripts/rag-manager.js create convenios-arg "Liquidación Argentina"
  node scripts/rag-manager.js upload docs/LCT.pdf convenios-arg --topic=LCT --department=legal
  node scripts/rag-manager.js list
`);
  }
}

main().catch((err) => {
  console.error("[RAG] Error:", err.message || err);
  process.exit(1);
});
