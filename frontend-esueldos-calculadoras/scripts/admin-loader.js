(async function () {
  const chunks = [
    "modules/pages/app-01.js",
    "modules/pages/app-02.js",
    "modules/pages/app-03.js",
    "modules/pages/app-04.js",
    "modules/pages/app-05.js",
    "modules/pages/app-06.js",
    "modules/pages/app-07.js",
    "modules/pages/app-08.js",
    "modules/pages/app-09.js",
    "modules/pages/app-10.js",
    "modules/pages/app-11.js",
    "modules/pages/app-12.js",
    "modules/pages/app-13.js",
    "modules/pages/app-14.js",
    "modules/pages/app-15.js"
  ];
  const source = (await Promise.all(chunks.map(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar ${path}: HTTP ${response.status}`);
    return response.text();
  }))).join("\n");
  (0, eval)(source);
})().catch((error) => {
  console.error("No se pudo iniciar e-Sueldos", error);
});
