const { z } = require("zod");

const dateString = z.string().min(1).optional().default("");

const employeeSchema = z.object({
  legajo: z.string().optional().default(""),
  name: z.string().optional().default("Sin nombre"),
  cuil: z.string().optional().default("-"),
  entryDate: z.string().optional().default(""),
  civilStatus: z.string().optional().default("soltero")
}).passthrough();

const calculationInputSchema = z.object({
  conventionId: z.string().min(1),
  period: z.string().min(1),
  categoryId: z.string().min(1),
  zoneId: z.string().min(1),
  employee: employeeSchema.optional().default({}),
  inputs: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().default({}),
  generatedAt: dateString
});

const moneyRowSchema = z.object({
  label: z.string().min(1),
  amount: z.number().finite(),
  detail: z.string().optional().default("")
});

const liquidationTotalsSchema = z.object({
  remTotal: z.number().finite(),
  noRemTotal: z.number().finite(),
  gross: z.number().finite(),
  deductions: z.number().finite(),
  employerContribs: z.number().finite(),
  net: z.number().finite(),
  employerCost: z.number().finite()
});

const liquidationResultSchema = z.object({
  conventionId: z.string().min(1),
  conventionName: z.string().min(1),
  period: z.string().min(1),
  employee: employeeSchema,
  category: z.object({ id: z.string().optional(), label: z.string().optional() }).passthrough(),
  zone: z.object({ id: z.string().optional(), label: z.string().optional() }).passthrough(),
  activeScale: z.any().nullable().optional(),
  remunerative: z.array(moneyRowSchema),
  nonRemunerative: z.array(moneyRowSchema),
  deductions: z.array(moneyRowSchema),
  employer: z.array(moneyRowSchema),
  details: z.array(moneyRowSchema),
  totals: liquidationTotalsSchema,
  calculation: z.object({
    engine: z.string(),
    version: z.string(),
    calculatedAt: z.string(),
    warnings: z.array(z.string())
  })
});

const savedLiquidationSchema = z.object({
  convention: z.string().min(1),
  conventionName: z.string().optional(),
  period: z.string().min(1),
  employee: employeeSchema.optional(),
  category: z.any().optional(),
  zone: z.any().optional(),
  totals: liquidationTotalsSchema,
  remunerative: z.array(moneyRowSchema).optional().default([]),
  nonRemunerative: z.array(moneyRowSchema).optional().default([]),
  deductions: z.array(moneyRowSchema).optional().default([]),
  employer: z.array(moneyRowSchema).optional().default([]),
  details: z.array(moneyRowSchema).optional().default([]),
  audit: z.any().optional()
}).passthrough();

const employeeWriteSchema = employeeSchema.extend({
  legajo: z.string().min(1),
  name: z.string().min(1),
  conventionId: z.string().optional(),
  category: z.string().optional(),
  zone: z.string().optional()
}).passthrough();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const userCreateSchema = loginSchema.extend({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "auditor", "operator"]).default("operator")
});

const userUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "auditor", "operator"]).optional(),
  active: z.boolean().optional()
});

function parseOrThrow(schema, payload, message = "Payload invalido") {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const error = new Error(message);
  error.status = 400;
  error.details = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
  throw error;
}

module.exports = {
  calculationInputSchema,
  employeeWriteSchema,
  loginSchema,
  liquidationResultSchema,
  savedLiquidationSchema,
  userCreateSchema,
  userUpdateSchema,
  parseOrThrow
};
