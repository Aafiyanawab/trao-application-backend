const { AppError } = require("../utils/errors");
const { QUESTION_CATEGORIES } = require("./gemini.service");

const QUESTION_SECTIONS = ["technical_questions", "non_technical_questions"];
const TEXT_SECTIONS = ["interviewer_questions", "interview_tips", "follow_up_guidance"];
const FLASHCARD_SECTION = "flashcards";
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:GEMINI_API_KEY|GITHUB_TOKEN|API_KEY|ACCESS_TOKEN|SECRET_KEY)\s*[:=]\s*["']?[A-Za-z0-9/+_.=-]{12,}/i,
];
const LEGACY_QUESTION_CATEGORIES = ["behavioral", "company_fit", "introduction", "motivation", "experience", "project", "certification", "skills"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidKit(details) {
  return new AppError("Generated interview kit is invalid", "INVALID_GENERATED_KIT", 422, details);
}

function normalizedText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function validateGeneratedInterviewKit(generatedKit, options = {}) {
  const details = [];
  if (!isPlainObject(generatedKit)) {
    throw invalidKit([{ path: "generatedKit", message: "must be an object" }]);
  }

  const sections = [...QUESTION_SECTIONS, ...TEXT_SECTIONS, FLASHCARD_SECTION];
  for (const section of sections) {
    if (!Object.prototype.hasOwnProperty.call(generatedKit, section)) {
      details.push({ path: section, message: "is required" });
    } else if (!Array.isArray(generatedKit[section])) {
      details.push({ path: section, message: "must be an array" });
    }
  }

  const requirements = options?.generationContext?.requirements;
  const knownRequirementIds = new Set();
  if (requirements !== undefined && !Array.isArray(requirements)) {
    details.push({ path: "generationContext.requirements", message: "must be an array" });
  } else if (Array.isArray(requirements)) {
    requirements.forEach((requirement, index) => {
      const path = `generationContext.requirements[${index}]`;
      if (!isPlainObject(requirement) || typeof requirement.id !== "string" || requirement.id.trim() === "") {
        details.push({ path: `${path}.id`, message: "must be a non-empty string" });
      } else if (knownRequirementIds.has(requirement.id)) {
        details.push({ path: `${path}.id`, message: "must be unique" });
      } else {
        knownRequirementIds.add(requirement.id);
      }
    });
  }

  const seenQuestionIds = new Map();
  const seenQuestionText = new Map();
  const seenFlashcardIds = new Map();
  const seenFlashcardContent = new Map();
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
      } else if (seenQuestionIds.has(question.id)) {
        details.push({ path: `${path}.id`, message: `duplicates question id at ${seenQuestionIds.get(question.id)}` });
      } else {
        seenQuestionIds.set(question.id, `${path}.id`);
      }
      if (typeof question.id === "string" && question.id.length > 200) details.push({ path: `${path}.id`, message: "must not exceed 200 characters" });

      if (typeof question.question !== "string" || question.question.trim() === "") {
        details.push({ path: `${path}.question`, message: "must be a non-empty string" });
      } else {
        if (question.question.length > 10000) details.push({ path: `${path}.question`, message: "must not exceed 10000 characters" });
        const normalized = normalizedText(question.question);
        if (seenQuestionText.has(normalized)) {
          details.push({ path: `${path}.question`, message: `duplicates question text at ${seenQuestionText.get(normalized)}` });
        } else {
          seenQuestionText.set(normalized, `${path}.question`);
        }
        textValues.push({ path: `${path}.question`, value: question.question });
      }

      if (typeof question.category !== "string" || question.category.trim() === "") {
        details.push({ path: `${path}.category`, message: "must be a non-empty string" });
      } else if (!(QUESTION_CATEGORIES.includes(question.category)
        || (options.allowLegacyQuestionContract && LEGACY_QUESTION_CATEGORIES.includes(question.category)))) {
        details.push({ path: `${path}.category`, message: "is not supported by the Gemini generation contract" });
      }
      if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 3) {
        details.push({ path: `${path}.difficulty`, message: "must be an integer between 1 and 3" });
      }
      if (typeof question.rationale !== "string" || question.rationale.trim() === "") {
        details.push({ path: `${path}.rationale`, message: "must be a non-empty string" });
      } else {
        if (question.rationale.length > 10000) details.push({ path: `${path}.rationale`, message: "must not exceed 10000 characters" });
        textValues.push({ path: `${path}.rationale`, value: question.rationale });
      }
      if (question.answer_outline === undefined && options.allowLegacyQuestionContract) {
        // Existing saved kits predate answer outlines; allow builder operations to preserve them.
      } else if (typeof question.answer_outline !== "string" || question.answer_outline.trim() === "") {
        details.push({ path: `${path}.answer_outline`, message: "must be a non-empty string" });
      } else {
        if (question.answer_outline.length > 10000) details.push({ path: `${path}.answer_outline`, message: "must not exceed 10000 characters" });
        textValues.push({ path: `${path}.answer_outline`, value: question.answer_outline });
      }

      if (!Array.isArray(question.requirement_ids) || question.requirement_ids.length === 0) {
        details.push({ path: `${path}.requirement_ids`, message: "must be a non-empty array" });
      } else {
        const seenQuestionRequirementIds = new Set();
        question.requirement_ids.forEach((requirementId, requirementIndex) => {
          const referencePath = `${path}.requirement_ids[${requirementIndex}]`;
          if (typeof requirementId !== "string" || requirementId.trim() === "") {
            details.push({ path: referencePath, message: "must be a non-empty string" });
          } else if (seenQuestionRequirementIds.has(requirementId)) {
            details.push({ path: referencePath, message: "duplicates a requirement ID within this question" });
          } else if (!knownRequirementIds.has(requirementId)) {
            details.push({ path: referencePath, message: `references unknown requirement '${requirementId}'` });
          } else {
            seenQuestionRequirementIds.add(requirementId);
          }
        });
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
        if (item.length > 10000) details.push({ path, message: "must not exceed 10000 characters" });
        textValues.push({ path, value: item });
      }
    });
  }

  const flashcards = generatedKit[FLASHCARD_SECTION];
  if (Array.isArray(flashcards)) {
    flashcards.forEach((flashcard, index) => {
      const path = `${FLASHCARD_SECTION}[${index}]`;
      if (!isPlainObject(flashcard)) {
        details.push({ path, message: "must be an object" });
        return;
      }

      if (typeof flashcard.id !== "string" || flashcard.id.trim() === "") {
        details.push({ path: `${path}.id`, message: "must be a non-empty string" });
      } else if (seenFlashcardIds.has(flashcard.id)) {
        details.push({ path: `${path}.id`, message: `duplicates flashcard id at ${seenFlashcardIds.get(flashcard.id)}` });
      } else {
        seenFlashcardIds.set(flashcard.id, `${path}.id`);
      }
      if (typeof flashcard.id === "string" && flashcard.id.length > 200) details.push({ path: `${path}.id`, message: "must not exceed 200 characters" });

      for (const field of ["front", "back"]) {
        if (typeof flashcard[field] !== "string" || flashcard[field].trim() === "") {
          details.push({ path: `${path}.${field}`, message: "must be a non-empty string" });
        } else {
          if (flashcard[field].length > 10000) details.push({ path: `${path}.${field}`, message: "must not exceed 10000 characters" });
          textValues.push({ path: `${path}.${field}`, value: flashcard[field] });
        }
      }

      if (!Array.isArray(flashcard.requirement_ids) || flashcard.requirement_ids.length === 0) {
        details.push({ path: `${path}.requirement_ids`, message: "must be a non-empty array" });
      } else {
        flashcard.requirement_ids.forEach((requirementId, requirementIndex) => {
          const referencePath = `${path}.requirement_ids[${requirementIndex}]`;
          if (typeof requirementId !== "string" || requirementId.trim() === "") {
            details.push({ path: referencePath, message: "must be a non-empty string" });
          } else if (!knownRequirementIds.has(requirementId)) {
            details.push({ path: referencePath, message: `references unknown requirement '${requirementId}'` });
          }
        });
      }

      if (typeof flashcard.front === "string" && typeof flashcard.back === "string") {
        const key = `${normalizedText(flashcard.front)}\u0000${normalizedText(flashcard.back)}`;
        if (seenFlashcardContent.has(key)) {
          details.push({ path: `${path}.front`, message: `duplicates flashcard content at ${seenFlashcardContent.get(key)}` });
        } else {
          seenFlashcardContent.set(key, path);
        }
      }
    });
  }

  for (const { path, value } of textValues) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      details.push({ path, message: "must not contain credential or private-key material" });
    }
  }

  if (details.length > 0) throw invalidKit(details);
  return generatedKit;
}

module.exports = {
  validateGeneratedInterviewKit,
};
