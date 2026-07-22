document.addEventListener('DOMContentLoaded', async () => {
  const localData = window.PAYROLL_DATA || window.DATA;
  let data = localData;
  const grid = document.getElementById('grid');

  function shortDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("es-AR", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function renderGrid(currentData) {
    if (!currentData || !currentData.conventions) return;
    const conventions = Object.values(currentData.conventions);
    grid.innerHTML = conventions.map(conv => {
      const readTime = Math.max(3, Math.floor(Math.random() * 8));
      const title = conv.metadata?.title || conv.name || conv.id;
      const desc = conv.metadata?.description || "Este convenio regula las condiciones laborales de la actividad. Calculadora parametrizada para uso en recibos de sueldo.";
      const dateStr = shortDate(conv.updatedAt || conv.createdAt || new Date());

      return `
        <article class="convention-card" onclick="openArticle('${conv.id}')">
          <div class="convention-badge">Liquidación por CCT</div>
          <div class="convention-content">
            <div style="font-size: 20px; font-weight: bold; margin-bottom: 12px; color: #000; text-indent: 0; visibility: visible; opacity: 1; display: block;">${title || 'Título No Encontrado'}</div>
            <p class="convention-copy">${desc}</p>
            <div class="convention-meta-article">
              ${dateStr} | <span aria-hidden="true">👁</span> ${readTime} min
            </div>
            <div class="convention-read-link">
              Leer artículo &rarr;
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  // 1. Mostrar inmediatamente los datos locales estáticos
  renderGrid(data);

  // 2. Traer los datos vivos de la base en segundo plano
  try {
    if (window.eSueldosApi) {
      const apiClient = window.eSueldosApi.createApiClient();
      const res = await fetch(apiClient.url("/api/catalog"));
      if (res.ok) {
        const apiData = await res.json();
        if (apiData && apiData.conventions) {
          const merged = { ...apiData };
          merged.conventions = { ...apiData.conventions };
          // Preserve local scales/additionals/rules for conventions that have them
          Object.keys(merged.conventions).forEach(id => {
            const local = localData?.conventions?.[id];
            if (local) {
              const backendConv = merged.conventions[id];
              const backendCatsEmpty = (backendConv.categories || []).every(c =>
                !c.monthly && !c.day && !c.hourly &&
                Object.keys(c.monthlyByPeriod || {}).length === 0 &&
                Object.keys(c.dayByPeriod || {}).length === 0 &&
                Object.keys(c.hourlyByPeriod || {}).length === 0
              );
              const useLocalCats = local.scales || (backendCatsEmpty && local.categories);
              merged.conventions[id] = {
                ...backendConv,
                scales: local.scales ?? backendConv.scales,
                nonRem: local.nonRem ?? backendConv.nonRem,
                additionals: local.additionals ?? backendConv.additionals,
                rules: local.rules ?? backendConv.rules,
                deductions: local.deductions ?? backendConv.deductions,
                categories: useLocalCats ? local.categories : backendConv.categories,
                zones: local.scales ? (local.zones ?? backendConv.zones) : backendConv.zones,
                periods: local.scales ? (local.periods ?? backendConv.periods) : backendConv.periods,
              };
            }
          });
          data = merged;
          window.PAYROLL_DATA = merged;
          window.DATA = merged;
          renderGrid(merged);
        }
      }
    }
  } catch (e) {
    console.warn("Usando datos estáticos locales (API no disponible).", e);
  }

  if (!data || !data.conventions) {
    console.error("No se encontraron datos de convenios");
  }
});

let currentArticleId = null;

function openArticle(id) {
  const data = window.PAYROLL_DATA || window.DATA;
  const conv = data.conventions[id];
  if(!conv) return;

  currentArticleId = id;
  const title = conv.metadata?.title || conv.name || conv.id;
  const dateStr = conv.updatedAt || conv.createdAt || new Date();
  
  // Format simple date
  const d = new Date(dateStr);
  const formattedDate = isNaN(d) ? dateStr : d.toLocaleDateString("es-AR", { year: "numeric", month: "2-digit", day: "2-digit" });
  const readTime = Math.max(3, Math.floor(Math.random() * 8));

  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMeta').innerHTML = `${formattedDate} | <span aria-hidden="true">👁</span> ${readTime} min`;
  
  const union = conv.metadata?.union || "-";
  const pCount = conv.periods ? conv.periods.length : 0;
  const cCount = conv.categories ? conv.categories.length : 0;
  const sueldoStr = conv.type === 'hourly' ? 'Por hora' : 'Mensual / Quincenal';

  document.getElementById('modalBody').innerHTML = `
    <p>${conv.source || "Este convenio regula las condiciones laborales de la actividad específica. La información detallada a continuación es utilizada por nuestro motor de liquidación para garantizar el cumplimiento de las normativas vigentes, escalas salariales y beneficios aplicables al trabajador."}</p>
    
    <h3>Aspectos Generales</h3>
    <p>La actividad enmarcada bajo la representación del sindicato <strong>${union}</strong> tiene un alcance geográfico a <strong>Nivel Nacional / Regional</strong>.</p>
    
    <h3>Reglas Automáticas y Beneficios</h3>
    <ul>
      <li><strong>Periodos:</strong> ${pCount} configurados.</li>
      <li><strong>Categorías:</strong> ${cCount} disponibles.</li>
      <li><strong>Sueldo:</strong> ${sueldoStr}.</li>
    </ul>
  `;

  const modal = document.getElementById('articleModal');
  modal.classList.add('active');
}

function closeArticle() {
  const modal = document.getElementById('articleModal');
  modal.classList.remove('active');
  currentArticleId = null;
}

document.getElementById('closeArticleBtn').addEventListener('click', closeArticle);

document.getElementById('articleModal').addEventListener('click', function(e) {
  if(e.target === this) {
    closeArticle();
  }
});

document.getElementById('btnLiquidar').addEventListener('click', () => {
  if (currentArticleId) {
    window.location.href = `articulo.html?id=${encodeURIComponent(currentArticleId)}`;
  }
});
