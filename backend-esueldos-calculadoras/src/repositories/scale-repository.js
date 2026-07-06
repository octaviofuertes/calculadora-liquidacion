function periodIdToMonth(periodId) {
  const match = String(periodId || "").toLowerCase().match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{2})$/);
  if (!match) return null;
  const months = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
  return `20${match[2]}-${months[match[1]]}`;
}

function normalizePeriod(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return periodIdToMonth(raw);
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function findActiveScale(db, conventionId, period) {
  const [first] = await findActiveScales(db, conventionId, period);
  return first || null;
}

async function findActiveScales(db, conventionId, period) {
  const normalized = normalizePeriod(period) || currentPeriod();
  return db.collection("salaryScales").find(
    {
      conventionId,
      status: "APROBADA",
      period: { $lte: normalized }
    },
    {
      sort: { period: -1, approvedAt: -1, createdAt: -1 }
    }
  ).toArray();
}

module.exports = {
  currentPeriod,
  findActiveScale,
  findActiveScales,
  normalizePeriod,
  periodIdToMonth
};
