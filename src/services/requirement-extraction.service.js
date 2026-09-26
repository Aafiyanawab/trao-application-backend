const { AppError } = require("../utils/errors");

const MANDATORY_HEADING = /^(?:requirements?|required(?: qualifications?)?|minimum qualifications?|must[- ]have|essential qualifications?)\s*:?$/i;
const NICE_HEADING = /^(?:preferred(?: qualifications?)?|nice[- ]to[- ]have|bonus(?: points)?|desired qualifications?)\s*:?$/i;
const PREFERRED_PREFIX = /^(?:preferred qualifications?|preferred|nice[- ]to[- ]have|bonus(?: points)?)\s*:\s*(.*)$/i;
const MANDATORY_PREFIX = /^(?:requirements?|required(?: qualifications?)?|minimum qualifications?|must[- ]have|essential qualifications?)\s*:\s*(.*)$/i;
const MANDATORY_CUE = /\b(?:required|must(?:\s+have)?|mandatory|essential|minimum|at least|need(?:ed)? to)\b/i;
const NICE_CUE = /\b(?:preferred|nice to have|bonus(?: points)?|desirable|a plus|would be a plus|ideally)\b/i;
const REQUIREMENT_CUE = /\b(?:experience|proficien(?:t|cy)|knowledge|familiar(?:ity)?|understanding|ability|skills?|certification|degree|education|years? of experience|background)\b/i;
const BEHAVIORAL_CUE = /\b(?:communication|collaboration|collaborative|leadership|mentoring|mentor|teamwork|interpersonal|stakeholder|conflict resolution|adaptability)\b/i;
const DOMAIN_CUE = /\b(?:domain|industry|healthcare|medical|finance|financial services|banking|insurance|retail|logistics|supply chain)\b/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(details) {
  return new AppError("Requirement extraction input is invalid", "VALIDATION_ERROR", 400, details);
}

function normalizeForComparison(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeRequirementText(text) {
  return text
    .replace(/^\s*(?:[-*+•‣▪]\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoClauses(userJd) {
  const clauses = [];
  let activeSectionPriority = null;
  for (const line of userJd.replace(/\r/g, "\n").split("\n")) {
    const normalizedLine = line.trim();
    if (!normalizedLine) continue;
    const sentences = normalizedLine.split(/(?<=[.!?;])\s+(?=[A-Z0-9•*-])/);
    for (const sentence of sentences) {
      let text = sentence.trim();
      if (!text) continue;

      const mandatoryPrefix = text.match(MANDATORY_PREFIX);
      const preferredPrefix = text.match(PREFERRED_PREFIX);
      if (mandatoryPrefix) {
        activeSectionPriority = "must";
        text = mandatoryPrefix[1].trim();
      } else if (preferredPrefix) {
        activeSectionPriority = "nice";
        text = preferredPrefix[1].trim();
      } else if (MANDATORY_HEADING.test(text)) {
        activeSectionPriority = "must";
        continue;
      } else if (NICE_HEADING.test(text)) {
        activeSectionPriority = "nice";
        continue;
      }

      const lines = text.split(/\s+(?=[-*+•‣▪]\s*)/);
      clauses.push({ text: normalizeRequirementText(lines.join(" ")), sectionPriority: activeSectionPriority });
    }
  }
  return clauses;
}

function classifyPriority(text, sectionPriority) {
  if (NICE_CUE.test(text)) return "nice";
  if (MANDATORY_CUE.test(text)) return "must";
  if (sectionPriority) return sectionPriority;
  return "nice";
}

function classifyKind(text) {
  if (BEHAVIORAL_CUE.test(text)) return "behavioural";
  if (DOMAIN_CUE.test(text)) return "domain";
  return "technical";
}

function validateInput(input) {
  const details = [];
  if (!isPlainObject(input)) {
    throw invalidInput([{ path: "input", message: "must be an object" }]);
  }

  const role = input.role;
  const roleName = typeof role === "string"
    ? role
    : isPlainObject(role)
      ? role.requested_role ?? role.title
      : undefined;
  if (typeof roleName !== "string" || roleName.trim() === "") {
    details.push({ path: "role", message: "must be a non-empty string or an object with requested_role/title" });
  }
  if (typeof input.userJd !== "string" || input.userJd.trim() === "") {
    details.push({ path: "userJd", message: "must be a non-empty string" });
  }

  if (details.length > 0) throw invalidInput(details);
  return { roleName: roleName.trim(), userJd: input.userJd };
}

function extractRequirements(input) {
  const { roleName, userJd } = validateInput(input);
  void roleName;

  const requirements = [];
  const indexesByText = new Map();
  for (const clause of splitIntoClauses(userJd)) {
    const text = clause.text;
    if (!text || (!REQUIREMENT_CUE.test(text) && !clause.sectionPriority)) continue;

    const normalized = normalizeForComparison(text);
    const priority = classifyPriority(text, clause.sectionPriority);
    if (indexesByText.has(normalized)) {
      const existing = requirements[indexesByText.get(normalized)];
      if (priority === "must") existing.priority = "must";
      continue;
    }

    indexesByText.set(normalized, requirements.length);
    requirements.push({ text, kind: classifyKind(text), priority });
  }

  return {
    requirements: requirements.map((requirement, index) => ({
      id: `r${index + 1}`,
      text: requirement.text,
      kind: requirement.kind,
      priority: requirement.priority,
    })),
  };
}

module.exports = {
  extractRequirements,
};
