const express = require("express");

function createAdminRouter({ getDb, seedCatalog }) {
  const router = express.Router();

  router.post("/api/admin/seed", async (req, res, next) => {
    try {
      const catalog = await seedCatalog(getDb());
      res.json({ ok: true, conventions: catalog.conventions.length });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminRouter
};
