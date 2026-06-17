const { escapeRegex } = require("../../middleware/validate");
const { employeeWriteSchema, parseOrThrow } = require("../../domain/schemas");

function normalizeEmployeePayload(payload) {
  return {
    ...payload,
    legajo: String(payload.legajo || "").trim(),
    name: String(payload.name || "").trim(),
    cuil: String(payload.cuil || "").trim(),
    entryDate: String(payload.entryDate || "").trim(),
    civilStatus: String(payload.civilStatus || "soltero").trim(),
    conventionId: String(payload.conventionId || "").trim(),
    category: String(payload.category || "").trim(),
    zone: String(payload.zone || "").trim()
  };
}

function createEmployeeUseCases({ employeeRepository }) {
  return {
    async getNextLegajo() {
      return { nextLegajo: await employeeRepository.nextLegajo() };
    },

    async search({ q, conventionId }) {
      if (!q) return [];
      const safeQuery = escapeRegex(String(q).slice(0, 80));
      const filter = { name: { $regex: safeQuery, $options: "i" } };
      if (conventionId && conventionId !== "null" && conventionId !== "undefined") {
        filter.conventionId = conventionId;
      }
      return employeeRepository.search(filter);
    },

    list() {
      return employeeRepository.list();
    },

    async getByLegajo(legajo) {
      const employee = await employeeRepository.findByLegajo(legajo);
      if (!employee) {
        const error = new Error("Empleado no encontrado");
        error.status = 404;
        throw error;
      }
      return employee;
    },

    async create(body) {
      const payload = normalizeEmployeePayload(parseOrThrow(employeeWriteSchema, body, "Empleado invalido"));
      const existing = await employeeRepository.findByLegajoRaw(payload.legajo);
      if (existing) {
        const error = new Error("El legajo ya existe");
        error.status = 400;
        throw error;
      }

      const now = new Date();
      return employeeRepository.insert({ ...payload, createdAt: now, updatedAt: now });
    },

    async update(id, body) {
      const payload = normalizeEmployeePayload(parseOrThrow(employeeWriteSchema.partial().passthrough(), body, "Empleado invalido"));
      const { id: ignoredId, _id, ...updateData } = payload;
      const employee = await employeeRepository.updateById(id, { ...updateData, updatedAt: new Date() });
      if (!employee) {
        const error = new Error("Empleado no encontrado");
        error.status = 404;
        throw error;
      }
      return employee;
    },

    async remove(id) {
      const result = await employeeRepository.deleteById(id);
      if (!result) {
        const error = new Error("ID invalido");
        error.status = 400;
        throw error;
      }
      if (result.deletedCount === 0) {
        const error = new Error("Empleado no encontrado");
        error.status = 404;
        throw error;
      }
      return { ok: true };
    }
  };
}

module.exports = {
  createEmployeeUseCases
};
