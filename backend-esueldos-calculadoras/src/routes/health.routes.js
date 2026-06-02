const express = require("express");

function createHealthRouter({ getDb }) {
  const router = express.Router();

  router.get("/api/health", async (req, res) => {
    try {
      const db = getDb();
      await db.command({ ping: 1 });
      res.json({ ok: true, mongo: true, db: db.databaseName });
    } catch (error) {
      res.status(503).json({ ok: false, mongo: false, error: error.message });
    }
  });

  return router;
}

module.exports = {
  createHealthRouter
};
