require('dotenv').config();
const { loadCatalogFromBackend, normalizeCatalog } = require('./src/catalog-loader');
const { validateConvention } = require('./src/services/catalog-service');
const { withConventionMetadata } = require('./src/domain/normative-versioning');

const catalog = normalizeCatalog(loadCatalogFromBackend());
console.log('Conventions to seed:', catalog.conventions.length);
catalog.conventions.forEach(conv => {
  try {
    const v = validateConvention(withConventionMetadata(conv));
    console.log('OK:', v.id, '|', v.name);
  } catch(e) {
    console.log('FAIL:', conv.id, '-', e.message.slice(0, 100));
  }
});
