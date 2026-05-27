# eSueldos - Liquidador multiconvenio

Primera version funcional del sistema de liquidacion multiconvenio.

## Convenios incluidos

- UOCRA CCT 76/75, basado en la calculadora `eSueldos_UOCRA_v5_2026`.
- Farmacia Mendoza CCT 429/2005, con escala abril 2026 y no remunerativos abril, mayo y junio 2026.
- Camioneros CCT 40/89, con planilla salarial mayo 2026 y coeficientes zonales 1,20 y 1,40.

## Archivos

- `index.html`: aplicacion principal.
- `styles.css`: interfaz responsive e impresion.
- `data.js`: escalas, constantes y fuentes.
- `app.js`: motor de liquidacion, recibo, detalle, escalas y exportacion JSON.

## Uso

Desde esta carpeta se puede levantar el front con Node sin instalar dependencias:

```bash
npm start
```

Luego abrir la URL que muestra la consola, por defecto `http://127.0.0.1:5173`.

Tambien se puede abrir `index.html` directo en el navegador. La aplicacion no requiere dependencias externas.

Con backend MongoDB activo, usar preferentemente:

```bash
cd ../backend-esueldos-calculadoras
npm start
```

Luego abrir `http://localhost:4100`. Si se abre como archivo local, la app intenta leer `http://localhost:4100/api/catalog` y vuelve a `data.js` si el backend no esta disponible.

## Notas de auditoria

Las alicuotas generales y constantes se concentraron en `data.js` para facilitar revision contable. El calculo es referencial y debe validarse contra normativa vigente, acuerdos homologados y criterio profesional antes de uso productivo.
