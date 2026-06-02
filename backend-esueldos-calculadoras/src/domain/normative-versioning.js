function approvedMetadata(source = "catalogo inicial eSueldos") {
  const now = new Date().toISOString();
  return {
    validFrom: process.env.NORMATIVE_VALID_FROM || "2026-01-01",
    validTo: process.env.NORMATIVE_VALID_TO || null,
    source,
    approvedBy: process.env.NORMATIVE_APPROVED_BY || "Auditoria humana",
    approvedAt: process.env.NORMATIVE_APPROVED_AT || now
  };
}

function versionConstants(constants = {}) {
  const meta = approvedMetadata("frontend/data.js migrado a catalogo backend");
  return Object.entries(constants)
    .filter(([, value]) => typeof value !== "object" || Array.isArray(value))
    .map(([key, value]) => ({ key, value, ...meta }));
}

function withConventionMetadata(convention) {
  const meta = approvedMetadata(convention.source || convention.name);
  return {
    ...convention,
    regulatoryMetadata: {
      ...(convention.regulatoryMetadata || {}),
      ...meta
    }
  };
}

module.exports = {
  approvedMetadata,
  versionConstants,
  withConventionMetadata
};
