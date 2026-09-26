const { AppError } = require("../utils/errors");
const { QUESTION_CATEGORIES } = require("./gemini.service");

const QUESTION_SECTIONS = ["technical_questions", "non_technical_questions"];
const TEXT_SECTIONS = ["interviewer_questions", "interview_tips", "follow_up_guidance"];
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:GEMINI_API_KEY|GITHUB_TOKEN|API_KEY|ACCESS_TOKEN|SECRET_KEY)\s*[:=]\s*["']?[A-Za-z0-9/+_.=-]{12,}/i,
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidKit(details) {
  return new AppError(
    "Generated interview kit is invalid",
    "INVALID_GENERATED_KIT",
    422,
    details,
  );
}

function normalizedQuestionText(question) {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

function validateGeneratedInterviewKit(generatedKit) {
  const details = [];
  if (!isPlainObject(generatedKit)) {
    throw invalidKit([{ path: "generatedKit", message: "must be an object" }]);
  }

  for (const section of [...QUESTION_SECTIONS, ...TEXT_SECTIONS]) {
    if (!Object.prototype.hasOwnProperty.call(generatedKit, section)) {
      details.push({ path: section, message: "is required" });
    } else if (!Array.isArray(generatedKit[section])) {
      details.push({ path: section, message: "must be an array" });
    }
  }

  const seenIds = new Map();
  const seenQuestions = new Map();
  const textValues = [];

  for (const section of QUESTION_SECTIONS) {
    const items = generatedKit[section];
    if (!Array.isArray(items)) continue;

    items.forEach((question, index) => {
      const path = `${section}[${index}]`;
      if (!isPlainObject(question)) {
        details.push({ path, message: "must be an object" });
        return;
      }

      if (typeof question.id !== "string" || question.id.trim() === "") {
        details.push({ path: `${path}.id`, message: "must be a non-empty string" });
      } else if (seenIds.has(question.id)) {
        details.push({
          path: `${path}.id`,
          message: `duplicates question id at ${seenIds.get(question.id)}`,
        });
      } else {
        seenIds.set(question.id, `${path}.id`);
      }

      if (typeof question.question !== "string" || question.question.trim() === "") {
        details.push({ path: `${path}.question`, message: "must be a non-empty string" });
      } else {
        const normalized = normalizedQuestionText(question.question);
        if (seenQuestions.has(normalized)) {
          details.push({
            path: `${path}.question`,
            message: `duplicates question text at ${seenQuestions.get(normalized)}`,
          });
        } else {
          seenQuestions.set(normalized, `${path}.question`);
        }
        textValues.push({ path: `${path}.question`, value: question.question });
      }

      if (typeof question.category !== "string" || question.category.trim() === "") {
        details.push({ path: `${path}.category`, message: "must be a non-empty string" });
      } else if (!QUESTION_CATEGORIES.includes(question.category)) {
        details.push({ path: `${path}.category`, message: "is not supported by the Gemini generation contract" });
      }

      if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 3) {
        details.push({ path: `${path}.difficulty`, message: "must be an integer between 1 and 3" });
      }

      if (typeof question.rationale !== "string" || question.rationale.trim() === "") {
        details.push({ path: `${path}.rationale`, message: "must be a non-empty string" });
      } else {
        textValues.push({ path: `${path}.rationale`, value: question.rationale });
      }
    });
  }

  for (const section of TEXT_SECTIONS) {
    const items = generatedKit[section];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      const path = `${section}[${index}]`;
      if (typeof item !== "string" || item.trim() === "") {
        details.push({ path, message: "must be a non-empty string" });
      } else {
        textValues.push({ path, value: item });
      }
    });
  }

  for (const { path, value } of textValues) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      details.push({ path, message: "must not contain credential or private-key material" });
    }
  }

  if (details.length > 0) {
    throw invalidKit(details);
  }

  return generatedKit;
}

module.exports = {
  validateGeneratedInterviewKit,
};
