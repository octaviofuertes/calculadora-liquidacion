const { ObjectId } = require("mongodb");

const GEMINI_COST_PER_1K = Number(process.env.GEMINI_COST_PER_1K || 0);
const OPENAI_COST_PER_1K = Number(process.env.OPENAI_COST_PER_1K || 0);

function estimateCost(provider, totalTokens, model) {
  const tokens = Number(totalTokens || 0);
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const rate = provider === "gemini" ? GEMINI_COST_PER_1K : provider === "openai" ? OPENAI_COST_PER_1K : 0;
  return rate > 0 ? Number(((tokens / 1000) * rate).toFixed(8)) : 0;
}

function buildUsageDocument({ provider, model, promptTokens = 0, completionTokens = 0, totalTokens = 0, draftId, operation }) {
  const doc = {
    provider: String(provider || "").toLowerCase(),
    model: String(model || "").trim(),
    operation: String(operation || "").trim(),
    promptTokens: Number(promptTokens || 0),
    completionTokens: Number(completionTokens || 0),
    totalTokens: Number(totalTokens || 0),
    estimatedCost: estimateCost(String(provider || "").toLowerCase(), totalTokens, model),
    createdAt: new Date()
  };
  const id = String(draftId || "").trim();
  if (ObjectId.isValid(id)) {
    doc.draftId = new ObjectId(id);
  }
  return doc;
}

async function logUsage(db, usage) {
  const doc = buildUsageDocument(usage);
  return db.collection("AiUsage").insertOne(doc);
}

async function getUsageSummary(db, provider) {
  const match = provider ? { provider: String(provider).toLowerCase() } : {};
  const summary = await db.collection("AiUsage").aggregate([
    { $match: match },
    {
      $group: {
        _id: provider ? "$provider" : null,
        requests: { $sum: 1 },
        promptTokens: { $sum: "$promptTokens" },
        completionTokens: { $sum: "$completionTokens" },
        totalTokens: { $sum: "$totalTokens" },
        estimatedCost: { $sum: "$estimatedCost" }
      }
    }
  ]).next();

  return {
    provider: provider ? String(provider).toLowerCase() : "all",
    requests: summary?.requests || 0,
    promptTokens: summary?.promptTokens || 0,
    completionTokens: summary?.completionTokens || 0,
    totalTokens: summary?.totalTokens || 0,
    estimatedCost: summary?.estimatedCost || 0
  };
}

async function getRecentUsages(db, provider, limit = 10) {
  const match = provider ? { provider: String(provider).toLowerCase() } : {};
  return db.collection("AiUsage")
    .find(match)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 10, 100))
    .toArray();
}

async function getUsageTimeSeries(db, provider, periodType = "day") {
  const match = provider ? { provider: String(provider).toLowerCase() } : {};
  const dateFormat = periodType === "month" ? "%Y-%m" : "%Y-%m-%d";
  const keys = await db.collection("AiUsage").aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
        requests: { $sum: 1 },
        promptTokens: { $sum: "$promptTokens" },
        completionTokens: { $sum: "$completionTokens" },
        totalTokens: { $sum: "$totalTokens" },
        estimatedCost: { $sum: "$estimatedCost" }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 30 }
  ]).toArray();

  return keys.map((item) => ({ period: item._id, ...item, _id: undefined }));
}

module.exports = {
  logUsage,
  getUsageSummary,
  getRecentUsages,
  getUsageTimeSeries
};
