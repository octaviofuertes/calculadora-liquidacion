const { savedLiquidationSchema, parseOrThrow } = require("../../domain/schemas");

function createLiquidationUseCases({ liquidationRepository, calculateLiquidation, getDb, serializeScale }) {
  return {
    list({ limit }) {
      return liquidationRepository.list(Math.min(Number(limit || 50), 200));
    },

    async getById(id) {
      const liquidation = await liquidationRepository.findById(id);
      if (!liquidation) {
        const error = new Error("Liquidacion no encontrada");
        error.status = 404;
        throw error;
      }
      return liquidation;
    },

    calculate(body) {
      return calculateLiquidation(getDb(), body, serializeScale);
    },

    save(body) {
      const payload = parseOrThrow(savedLiquidationSchema, body, "Liquidacion invalida");
      const now = new Date();
      return liquidationRepository.insert({ ...payload, createdAt: now, updatedAt: now });
    },

    async remove(id) {
      const result = await liquidationRepository.deleteById(id);
      if (!result) {
        const error = new Error("ID invalido");
        error.status = 400;
        throw error;
      }
      if (result.deletedCount === 0) {
        const error = new Error("Liquidacion no encontrada");
        error.status = 404;
        throw error;
      }
      return { ok: true };
    }
  };
}

module.exports = {
  createLiquidationUseCases
};
