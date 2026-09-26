const { AppError } = require("../utils/errors");
const { extractRequirements } = require("./requirement-extraction.service");

const COMPANY_TEXT_FIELDS = [
  "summary",
  "what_they_do",
  "products_services",
  "industry_domain",
  "careers_information",
];
const ROLE_NULLABLE_FIELDS = ["job_url", "job_title", "public_jd"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validationError(details) {
  return new AppError("Generation context input is invalid", "VALIDATION_ERROR", 400, details);
}

function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
  }
  return value;
}

function validateResearchContext(context) {
  const details = [];
  if (!isPlainObject(context)) {
    throw validationError([{ path: "researchContext", message: "must be an object" }]);
  }

  if (!isPlainObject(context.company)) {
    details.push({ path: "company", message: "must be an object" });
  } else {
    for (const field of ["name", "url"]) {
      if (typeof context.company[field] !== "string" || context.company[field].trim() === "") {
        details.push({ path: `company.${field}`, message: "must be a non-empty string" });
      }
    }
    for (const field of COMPANY_TEXT_FIELDS) {
      const value = context.company[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        details.push({ path: `company.${field}`, message: "must be a string or null" });
      }
    }
  }

  if (!isPlainObject(context.role)) {
    details.push({ path: "role", message: "must be an object" });
  } else {
    if (typeof context.role.requested_role !== "string" || context.role.requested_role.trim() === "") {
      details.push({ path: "role.requested_role", message: "must be a non-empty string" });
    }
    if (typeof context.role.matching_role_found !== "boolean") {
      details.push({ path: "role.matching_role_found", message: "must be a boolean" });
    }
    if (context.role.job_source !== "company_public_page" && context.role.job_source !== "user_provided") {
      details.push({ path: "role.job_source", message: "must be company_public_page or user_provided" });
    }
    if (typeof context.role.user_jd !== "string") {
      details.push({ path: "role.user_jd", message: "must be a string" });
    }
    for (const field of ROLE_NULLABLE_FIELDS) {
      const value = context.role[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        details.push({ path: `role.${field}`, message: "must be a string or null" });
      }
    }
    if (context.role.matching_role_found === true && context.role.job_source !== "company_public_page") {
      details.push({ path: "role.job_source", message: "must be company_public_page when a public role was found" });
    }
    if (context.role.matching_role_found === false && context.role.job_source !== "user_provided") {
      details.push({ path: "role.job_source", message: "must be user_provided when no public role was found" });
    }
    if (context.role.matching_role_found === false && context.role.public_jd !== null) {
      details.push({ path: "role.public_jd", message: "must be null when no public role was found" });
    }
  }

  if (!isPlainObject(context.research)) {
    details.push({ path: "research", message: "must be an object" });
  } else {
    for (const field of ["sources", "pages_used", "research_gaps", "warnings"]) {
      if (!Array.isArray(context.research[field])) {
        details.push({ path: `research.${field}`, message: "must be an array" });
      }
    }
    if (Array.isArray(context.research.sources)) {
      context.research.sources.forEach((source, index) => {
        if (!isPlainObject(source)) {
          details.push({ path: `research.sources[${index}]`, message: "must be an object" });
        }
      });
    }
    if (Array.isArray(context.research.pages_used)) {
      context.research.pages_used.forEach((url, index) => {
        if (typeof url !== "string") {
          details.push({ path: `research.pages_used[${index}]`, message: "must be a string" });
        }
      });
    }
    if (Array.isArray(context.research.research_gaps)) {
      context.research.research_gaps.forEach((gap, index) => {
        if (typeof gap !== "string") {
          details.push({ path: `research.research_gaps[${index}]`, message: "must be a string" });
        }
      });
    }
    if (Array.isArray(context.research.warnings)) {
      context.research.warnings.forEach((warning, index) => {
        if (typeof warning !== "string" && !isPlainObject(warning)) {
          details.push({ path: `research.warnings[${index}]`, message: "must be an object or string" });
        }
      });
    }
  }

  if (details.length > 0) throw validationError(details);
}

function buildGenerationContext(researchContext) {
  validateResearchContext(researchContext);
  const requirements = researchContext.role.user_jd.trim()
    ? extractRequirements({ role: researchContext.role.requested_role, userJd: researchContext.role.user_jd }).requirements
    : [];

  const company = {
    name: researchContext.company.name,
    url: researchContext.company.url,
  };
  COMPANY_TEXT_FIELDS.forEach((field) => {
    company[field] = researchContext.company[field] === undefined
      ? ""
      : researchContext.company[field];
  });

  const matchingRoleFound = researchContext.role.matching_role_found;
  const role = {
    requested_role: researchContext.role.requested_role,
    matching_role_found: matchingRoleFound,
    job_source: matchingRoleFound ? "company_public_page" : "user_provided",
    job_url: matchingRoleFound ? researchContext.role.job_url ?? null : null,
    job_title: matchingRoleFound ? researchContext.role.job_title ?? null : null,
    public_jd: matchingRoleFound ? researchContext.role.public_jd ?? null : null,
    user_jd: researchContext.role.user_jd,
  };

  return {
    company,
    role,
    requirements,
    research: {
      sources: cloneData(researchContext.research.sources),
      pages_used: cloneData(researchContext.research.pages_used),
      research_gaps: cloneData(researchContext.research.research_gaps),
      warnings: cloneData(researchContext.research.warnings),
    },
  };
}

module.exports = {
  buildGenerationContext,
};
