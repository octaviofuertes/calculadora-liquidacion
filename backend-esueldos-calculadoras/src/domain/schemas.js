const { z } = require("zod");
const { convenioSchema: conventionSchema } = require("../models/convenio.model");

const dateString = z.string().min(1).optional().default("");
const optionalFiniteNumber = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.number().finite().optional()
);
const optionalFiniteNumberRecord = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, amount]) => amount !== null && amount !== "")
  );
}, z.record(z.number().finite()).optional());
const conceptCalculationSchema = z.preprocess(
  (value) => (value === "percentOfBase" ? "percent" : value),
  z.enum(["fixed", "percent", "amountPerUnit"]).optional()
);

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
  activeScales: z.array(z.any()).optional().default([]),
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

const periodSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  validFrom: z.string().optional()
}).passthrough();

const zoneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  coef: z.number().finite().optional().default(1)
}).passthrough();

const categorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  salaryType: z.enum(["monthly", "daily", "hourly"]).optional(),
  monthly: z.union([z.number().finite(), z.boolean()]).optional(),
  day: optionalFiniteNumber,
  hourly: optionalFiniteNumber,
  monthlyByPeriod: optionalFiniteNumberRecord,
  dayByPeriod: optionalFiniteNumberRecord,
  hourlyByPeriod: optionalFiniteNumberRecord,
  nonRemunerativeByPeriod: optionalFiniteNumberRecord
}).passthrough();

const normativeSchema = z.object({
  validFrom: z.string().min(1),
  validTo: z.string().nullable().optional(),
  source: z.string().min(1),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional()
}).passthrough();

const conceptSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rowType: z.enum(["remunerative", "nonRemunerative", "deduction", "employer"]).optional(),
  calculation: conceptCalculationSchema,
  base: z.string().optional(),
  percent: optionalFiniteNumber,
  amount: optionalFiniteNumber,
  defaultValue: z.union([z.boolean(), z.number(), z.string()]).optional()
}).passthrough();

const legacyConventionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().optional(),
  source: z.string().optional(),
  type: z.enum(["monthly", "daily", "hourly"]).optional(),
  calculationMode: z.string().optional(),
  normative: normativeSchema.optional(),
  periods: z.array(periodSchema).min(1),
  zones: z.array(zoneSchema).optional().default([{ id: "general", label: "General", coef: 1 }]),
  categories: z.array(categorySchema).min(1),
  rules: z.record(z.any()).optional().default({}),
  items: z.record(z.any()).optional().default({}),
  liquidationModel: z.object({
    rules: z.record(z.any()).optional().default({}),
    concepts: z.array(conceptSchema).optional().default([])
  }).passthrough().optional()
}).passthrough().superRefine((convention, ctx) => {
  const periodIds = new Set(convention.periods.map((period) => period.id));
  const hasConventionScaleMap = !!convention.scales || !!convention.nonRem;
  convention.categories.forEach((category, index) => {
    const hasScaleValue = Number.isFinite(Number(category.monthly))
      || Number.isFinite(category.day)
      || Number.isFinite(category.hourly)
      || Object.keys(category.monthlyByPeriod || {}).length > 0
      || Object.keys(category.dayByPeriod || {}).length > 0
      || Object.keys(category.hourlyByPeriod || {}).length > 0;
    if (!hasScaleValue && !hasConventionScaleMap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categories", index],
        message: "La categoria debe tener un importe mensual, diario, horario o por periodo"
      });
    }
    ["monthlyByPeriod", "dayByPeriod", "hourlyByPeriod", "nonRemunerativeByPeriod"].forEach((field) => {
      Object.keys(category[field] || {}).forEach((periodId) => {
        if (!periodIds.has(periodId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories", index, field, periodId],
            message: "El periodo de escala no existe en periods"
          });
        }
      });
    });
  });
});

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
  conventionSchema,
  legacyConventionSchema,
  userCreateSchema,
  userUpdateSchema,
  parseOrThrow
};
