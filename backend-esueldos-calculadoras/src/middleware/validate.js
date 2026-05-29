function validateBody(schema, message) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.body || {});
      if (!result.success) {
        res.status(400).json({
          error: message || "Payload invalido",
          details: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        });
        return;
      }
      req.validatedBody = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  validateBody,
  escapeRegex
};
