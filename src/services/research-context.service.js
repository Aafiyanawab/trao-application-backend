const { AppError } = require("../utils/errors");

const COMPANY_TEXT_FIELDS = [
  "summary",
  "what_they_do",
  "products_services",
  "industry_domain",
  "careers_information",
];
const ROLE_TEXT_FIELDS = ["requested_role", "job_title", "public_jd"];

function validationError(details) {
  return new AppError("Research result is invalid", "VALIDATION_ERROR", 400, details);
}

function addRequiredString(details, value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    details.push({ path, message: "must be a non-empty string" });
  }
}

function addOptionalTextErrors(details, value, path) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    details.push({ path, message: "must be a string or null" });
  }
}

function uniqueByUrl(items, path, details) {
  if (items === undefined) return [];
  if (!Array.isArray(items)) {
    details.push({ path, message: "must be an array" });
    return [];
  }

  const seenUrls = new Set();
  const uniqueItems = [];
  items.forEach((item, index) => {
    if (typeof item === "string" && path === "pages_used") {
      if (!seenUrls.has(item)) {
        seenUrls.add(item);
        uniqueItems.push(item);
      }
      return;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      details.push({ path: `${path}[${index}]`, message: "must be an object with a URL" });
      return;
    }
    if (typeof item.url !== "string" || item.url.trim() === "") {
      details.push({ path: `${path}[${index}].url`, message: "must be a non-empty string" });
      return;
    }
    if (!seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push({ ...item });
    }
  });

  return uniqueItems;
}

function cloneWarnings(warnings, details) {
  if (warnings === undefined) return [];
  if (!Array.isArray(warnings)) {
    details.push({ path: "warnings", message: "must be an array" });
    return [];
  }

  return warnings.map((warning, index) => {
    if (warning && typeof warning === "object" && !Array.isArray(warning)) {
      return { ...warning };
    }
    if (typeof warning === "string") return warning;
    details.push({ path: `warnings[${index}]`, message: "must be an object or string" });
    return warning;
  });
}

function isMeaningfulText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function buildResearchContext(researchResult) {
  const details = [];
  if (!researchResult || typeof researchResult !== "object" || Array.isArray(researchResult)) {
    throw validationError([{ path: "researchResult", message: "must be an object" }]);
  }

  const company = researchResult.company;
  const role = researchResult.role_research;
  if (!company || typeof company !== "object" || Array.isArray(company)) {
    details.push({ path: "company", message: "must be an object" });
  }
  if (!role || typeof role !== "object" || Array.isArray(role)) {
    details.push({ path: "role_research", message: "must be an object" });
  }
  if (typeof researchResult.user_jd !== "string") {
    details.push({ path: "user_jd", message: "must be a string" });
  }

  if (company && typeof company === "object" && !Array.isArray(company)) {
    addRequiredString(details, company.name, "company.name");
    addRequiredString(details, company.url, "company.url");
    COMPANY_TEXT_FIELDS.forEach((field) => addOptionalTextErrors(details, company[field], `company.${field}`));
  }
  if (role && typeof role === "object" && !Array.isArray(role)) {
    addRequiredString(details, role.requested_role, "role_research.requested_role");
    if (typeof role.matching_role_found !== "boolean") {
      details.push({ path: "role_research.matching_role_found", message: "must be a boolean" });
    }
    ROLE_TEXT_FIELDS.slice(1).forEach((field) =>
      addOptionalTextErrors(details, role[field], `role_research.${field}`),
    );
    if (role.job_url !== undefined && role.job_url !== null && typeof role.job_url !== "string") {
      details.push({ path: "role_research.job_url", message: "must be a string or null" });
    }
  }

  const sources = company && typeof company === "object" && !Array.isArray(company)
    ? uniqueByUrl(company.sources, "company.sources", details)
    : [];
  const pagesUsed = uniqueByUrl(researchResult.pages_used, "pages_used", details);
  const warnings = cloneWarnings(researchResult.warnings, details);

  if (details.length > 0) throw validationError(details);

  const matchingRoleFound = role.matching_role_found;
  const publicJd = matchingRoleFound ? role.public_jd ?? null : null;
  const roleSource = matchingRoleFound ? "company_public_page" : "user_provided";
  const normalizedCompany = {
    name: company.name,
    url: company.url,
  };
  COMPANY_TEXT_FIELDS.forEach((field) => {
    normalizedCompany[field] = company[field] === undefined ? "" : company[field];
  });
  normalizedCompany.sources = sources;

  const normalizedRole = {
    requested_role: role.requested_role,
    matching_role_found: matchingRoleFound,
    job_source: roleSource,
    job_url: matchingRoleFound ? role.job_url ?? null : null,
    job_title: matchingRoleFound ? role.job_title ?? null : null,
    public_jd: publicJd,
    user_jd: researchResult.user_jd,
  };

  const researchGaps = [];
  if (!matchingRoleFound) researchGaps.push("public_role_not_found");
  if (matchingRoleFound && !isMeaningfulText(publicJd)) researchGaps.push("public_jd_unavailable");
  if (
    !COMPANY_TEXT_FIELDS.slice(0, 4).some((field) => isMeaningfulText(company[field])) &&
    !sources.some((source) => isMeaningfulText(source.text))
  ) {
    researchGaps.push("limited_company_information");
  }
  if (
    !isMeaningfulText(company.careers_information) &&
    !sources.some((source) => source.type === "careers" && isMeaningfulText(source.text))
  ) {
    researchGaps.push("careers_information_unavailable");
  }

  return {
    company: normalizedCompany,
    role: normalizedRole,
    sources,
    pages_used: pagesUsed,
    research_gaps: researchGaps,
    warnings,
  };
}

module.exports = {
  buildResearchContext,
};
