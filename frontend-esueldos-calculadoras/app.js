(async function () {
  const chunks = [
    "app.parts/app-01.js",
    "app.parts/app-02.js",
    "app.parts/app-03.js",
    "app.parts/app-04.js",
    "app.parts/app-05.js",
    "app.parts/app-06.js",
    "app.parts/app-07.js",
    "app.parts/app-08.js",
    "app.parts/app-09.js",
    "app.parts/app-10.js",
    "app.parts/app-11.js",
    "app.parts/app-12.js",
    "app.parts/app-13.js",
    "app.parts/app-14.js"
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
