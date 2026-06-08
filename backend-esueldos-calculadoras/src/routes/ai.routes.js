const express = require("express");
const tokenMetrics = require("../services/token-metrics");

function createAiRouter({ getDb }) {
  const router = express.Router();

  router.get("/api/ai/usage", async (req, res, next) => {
    try {
      const summary = await tokenMetrics.getUsageSummary(getDb());
      const recentExecutions = await tokenMetrics.getRecentUsages(getDb(), null, 10);
      const daily = await tokenMetrics.getUsageTimeSeries(getDb(), null, "day");
      const monthly = await tokenMetrics.getUsageTimeSeries(getDb(), null, "month");
      res.json({
        provider: "all",
        ...summary,
        recentExecutions,
        daily,
        monthly
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/ai/usage/gemini", async (req, res, next) => {
    try {
      const summary = await tokenMetrics.getUsageSummary(getDb(), "gemini");
      const recentExecutions = await tokenMetrics.getRecentUsages(getDb(), "gemini", 10);
      const daily = await tokenMetrics.getUsageTimeSeries(getDb(), "gemini", "day");
      const monthly = await tokenMetrics.getUsageTimeSeries(getDb(), "gemini", "month");
      res.json({ provider: "gemini", ...summary, recentExecutions, daily, monthly });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/ai/usage/openai", async (req, res, next) => {
    try {
      const summary = await tokenMetrics.getUsageSummary(getDb(), "openai");
      const recentExecutions = await tokenMetrics.getRecentUsages(getDb(), "openai", 10);
      const daily = await tokenMetrics.getUsageTimeSeries(getDb(), "openai", "day");
      const monthly = await tokenMetrics.getUsageTimeSeries(getDb(), "openai", "month");
      res.json({ provider: "openai", ...summary, recentExecutions, daily, monthly });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAiRouter
};
