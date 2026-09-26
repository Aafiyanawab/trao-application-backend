const { AppError } = require("../utils/errors");
const { generateInterviewKit: generateContent } = require("./interview-generation.service");
const { validateGeneratedInterviewKit } = require("./generated-kit-validation.service");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateGenerationContext(context) {
  const details = [];
  if (!isPlainObject(context)) {
    details.push({ path: "generationContext", message: "is required and must be an object" });
  } else {
    for (const section of ["company", "role", "research"]) {
      if (!isPlainObject(context[section])) {
        details.push({ path: `generationContext.${section}`, message: "must be an object" });
      }
    }
    if (isPlainObject(context.company)) {
      for (const field of ["name", "url"]) {
        if (typeof context.company[field] !== "string" || context.company[field].trim() === "") {
          details.push({ path: `generationContext.company.${field}`, message: "must be a non-empty string" });
        }
      }
    }
    if (isPlainObject(context.role)) {
      if (typeof context.role.requested_role !== "string" || context.role.requested_role.trim() === "") {
        details.push({ path: "generationContext.role.requested_role", message: "must be a non-empty string" });
      }
      if (typeof context.role.matching_role_found !== "boolean") {
        details.push({ path: "generationContext.role.matching_role_found", message: "must be a boolean" });
      }
      if (! ["company_public_page", "user_provided"].includes(context.role.job_source)) {
        details.push({ path: "generationContext.role.job_source", message: "must be company_public_page or user_provided" });
      }
      if (typeof context.role.user_jd !== "string") {
        details.push({ path: "generationContext.role.user_jd", message: "must be a string" });
      }
      if (context.role.matching_role_found === false && context.role.job_source !== "user_provided") {
        details.push({ path: "generationContext.role.job_source", message: "must be user_provided when no public role was found" });
      }
      if (context.role.matching_role_found === false && context.role.public_jd !== null) {
        details.push({ path: "generationContext.role.public_jd", message: "must be null when no public role was found" });
      }
    }
    if (isPlainObject(context.research)) {
      for (const field of ["sources", "pages_used", "research_gaps", "warnings"]) {
        if (!Array.isArray(context.research[field])) {
          details.push({ path: `generationContext.research.${field}`, message: "must be an array" });
        }
      }
    }
  }

  if (details.length > 0) {
    throw new AppError("Interview kit input is invalid", "VALIDATION_ERROR", 400, details);
  }
}

function createInterviewKitService({
  generate = generateContent,
  validate = validateGeneratedInterviewKit,
} = {}) {
  if (typeof generate !== "function") throw new TypeError("generate must be a function");
  if (typeof validate !== "function") throw new TypeError("validate must be a function");

  async function generateInterviewKit({ generationContext, candidateContext, githubContext } = {}) {
    validateGenerationContext(generationContext);
    const generatedKit = await generate(generationContext, candidateContext, githubContext);
    return validate(generatedKit);
  }

  return { generateInterviewKit };
}

const defaultService = createInterviewKitService();

module.exports = {
  createInterviewKitService,
  generateInterviewKit: defaultService.generateInterviewKit,
};
