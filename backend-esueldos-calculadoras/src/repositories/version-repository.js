function stableVersionId(prefix, id, effectiveFrom, reviewedAt) {
  const stamp = reviewedAt instanceof Date ? reviewedAt.toISOString() : String(reviewedAt || new Date().toISOString());
  return `${prefix}:${id}:${effectiveFrom || "sin-vigencia"}:${stamp}`;
}

async function saveConventionVersion(db, convention, meta = {}) {
  const now = meta.approvedAt || new Date();
  const effectiveFrom = meta.validFrom || convention.normative?.validFrom || convention.periods?.[0]?.validFrom || "";
  const version = {
    _id: stableVersionId("convention", convention.id, effectiveFrom, now),
    conventionId: convention.id,
    version: meta.version || now.toISOString(),
    status: meta.status || "APROBADA",
    validFrom: effectiveFrom,
    validTo: meta.validTo || convention.normative?.validTo || null,
    source: meta.source || convention.source || convention.normative?.source || "",
    approvedBy: meta.approvedBy || convention.normative?.approvedBy || "Auditoria humana",
    approvedAt: now,
    sourceDraftId: meta.sourceDraftId || convention.sourceDraftId || null,
    snapshot: convention,
    createdAt: now
  };

  await db.collection("conventionVersions").replaceOne(
    { _id: version._id },
    version,
    { upsert: true }
  );
  return version;
}

async function saveScaleVersion(db, scale, meta = {}) {
  const now = meta.approvedAt || new Date();
  const version = {
    _id: stableVersionId("scale", String(scale._id || scale.id), scale.period, now),
    scaleId: String(scale._id || scale.id),
    conventionId: scale.conventionId,
    period: scale.period,
    version: meta.version || now.toISOString(),
    status: meta.status || "APROBADA",
    source: meta.source || scale.sourceFileName || scale.originalName || "",
    approvedBy: meta.approvedBy || scale.reviewedBy || "Auditoria humana",
    approvedAt: now,
    snapshot: scale,
    createdAt: now
  };

  await db.collection("scaleVersions").replaceOne(
    { _id: version._id },
    version,
    { upsert: true }
  );
  return version;
}

async function ensureVersionIndexes(db) {
  await db.collection("conventionVersions").createIndex({ conventionId: 1, approvedAt: -1 });
  await db.collection("conventionVersions").createIndex({ conventionId: 1, validFrom: -1 });
  await db.collection("scaleVersions").createIndex({ conventionId: 1, period: -1, approvedAt: -1 });
}

module.exports = {
  ensureVersionIndexes,
  saveConventionVersion,
  saveScaleVersion
};
