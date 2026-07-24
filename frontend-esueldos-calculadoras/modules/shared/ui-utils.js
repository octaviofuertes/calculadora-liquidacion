(function () {
  const money = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function fmt(value) {
    return money.format(Number.isFinite(value) ? value : 0);
  }

  function round2(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sumRows(rows = []) {
    return rows.reduce((total, row) => total + Number(row?.amount || 0), 0);
  }

  window.eSueldosUi = {
    escapeHtml,
    fmt,
    round2,
    sumRows
  };
})();
