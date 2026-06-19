const fs = require("fs");
const path = require("path");

function loadChunkedModule(filename, targetModule, chunks) {
  const source = chunks
    .map((chunk) => fs.readFileSync(path.resolve(path.dirname(filename), chunk), "utf8"))
    .join("\n");

  targetModule._compile(source, filename);
}

module.exports = loadChunkedModule;
