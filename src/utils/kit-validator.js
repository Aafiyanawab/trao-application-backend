const { AppError } = require("./errors");

const REQUIREMENT_KINDS = new Set(["technical", "behavioural", "domain"]);
const REQUIREMENT_PRIORITIES = new Set(["must", "nice"]);
const QUESTION_CATEGORIES = new Set([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateKitStructure(kit) {
  const errors = [];
  const addError = (path, message) => errors.push({ path, message });
  const required = (value, path, type) => {
    if (value === undefined) {
      addError(path, "is required");
      return false;
    }

    if (type === "object" && !isPlainObject(value)) {
      addError(path, "must be an object");
      return false;
    }

    if (type === "array" && !Array.isArray(value)) {
      addError(path, "must be an array");
      return false;
    }

    return true;
  };
  const stringField = (value, path) => {
    if (typeof value !== "string") {
      addError(path, "must be a string");
    }
  };
  const integerField = (value, path, minimum = undefined) => {
    if (!Number.isInteger(value) || (minimum !== undefined && value < minimum)) {
      const suffix = minimum === undefined ? "" : ` greater than or equal to ${minimum}`;
      addError(path, `must be an integer${suffix}`);
    }
  };
  const stringArray = (value, path) => {
    if (!Array.isArray(value)) {
      addError(path, "must be an array");
      return;
    }

    value.forEach((item, index) => stringField(item, `${path}[${index}]`));
  };
  const uniqueIds = (items, path) => {
    const ids = new Set();
    items.forEach((item, index) => {
      const itemPath = `${path}[${index}].id`;
      if (!isPlainObject(item)) {
        addError(`${path}[${index}]`, "must be an object");
        return;
      }
      if (typeof item.id !== "string" || item.id.trim() === "") {
        addError(itemPath, "must be a non-empty string");
        return;
      }

      if (ids.has(item.id)) {
        addError(itemPath, "must be unique within the kit");
      }
      ids.add(item.id);
    });

    return ids;
  };
  const referenceArray = (value, path, knownIds) => {
    if (!Array.isArray(value)) {
      addError(path, "must be an array");
      return;
    }

    value.forEach((id, index) => {
      const itemPath = `${path}[${index}]`;
      if (typeof id !== "string" || id.trim() === "") {
        addError(itemPath, "must be a non-empty string");
      } else if (!knownIds.has(id)) {
        addError(itemPath, `references unknown id '${id}'`);
      }
    });
  };

  if (!isPlainObject(kit)) {
    throw new AppError(
      "Kit structure validation failed",
      "VALIDATION_ERROR",
      400,
      [{ path: "kit", message: "must be an object" }],
    );
  }

  const topLevelFields = [
    "source",
    "company_brief",
    "role",
    "questions",
    "flashcards",
    "schedule",
    "coverage",
  ];
  topLevelFields.forEach((field) => {
    required(kit[field], field, ["questions", "flashcards"].includes(field) ? "array" : "object");
  });

  if (isPlainObject(kit.source)) {
    ["company", "company_url", "role", "location", "researched_at"].forEach((field) => {
      if (!hasOwn(kit.source, field)) {
        addError(`source.${field}`, "is required");
      } else {
        stringField(kit.source[field], `source.${field}`);
      }
    });
    if (!hasOwn(kit.source, "jd_chars")) {
      addError("source.jd_chars", "is required");
    } else {
      integerField(kit.source.jd_chars, "source.jd_chars", 0);
    }
    if (!hasOwn(kit.source, "pages_used")) {
      addError("source.pages_used", "is required");
    } else {
      stringArray(kit.source.pages_used, "source.pages_used");
    }
  }

  if (isPlainObject(kit.company_brief)) {
    ["summary", "what_they_do"].forEach((field) => {
      if (!hasOwn(kit.company_brief, field)) {
        addError(`company_brief.${field}`, "is required");
      } else {
        stringField(kit.company_brief[field], `company_brief.${field}`);
      }
    });
    if (!hasOwn(kit.company_brief, "sources")) {
      addError("company_brief.sources", "is required");
    } else {
      stringArray(kit.company_brief.sources, "company_brief.sources");
    }
  }

  let requirementIds = new Set();
  if (isPlainObject(kit.role)) {
    ["title", "seniority"].forEach((field) => {
      if (!hasOwn(kit.role, field)) {
        addError(`role.${field}`, "is required");
      } else {
        stringField(kit.role[field], `role.${field}`);
      }
    });
    ["responsibilities", "requirements"].forEach((field) => {
      if (!hasOwn(kit.role, field)) {
        addError(`role.${field}`, "is required");
      } else if (!Array.isArray(kit.role[field])) {
        addError(`role.${field}`, "must be an array");
      }
    });
    if (Array.isArray(kit.role.responsibilities)) {
      stringArray(kit.role.responsibilities, "role.responsibilities");
    }
    if (Array.isArray(kit.role.requirements)) {
      requirementIds = uniqueIds(kit.role.requirements, "role.requirements");
      kit.role.requirements.forEach((requirement, index) => {
        const path = `role.requirements[${index}]`;
        if (!isPlainObject(requirement)) {
          addError(path, "must be an object");
          return;
        }
        ["id", "text", "kind", "priority"].forEach((field) => {
          if (!hasOwn(requirement, field)) {
            addError(`${path}.${field}`, "is required");
          }
        });
        if (hasOwn(requirement, "text")) stringField(requirement.text, `${path}.text`);
        if (hasOwn(requirement, "kind")) {
          if (!REQUIREMENT_KINDS.has(requirement.kind)) {
            addError(`${path}.kind`, "must be technical, behavioural, or domain");
          }
        }
        if (hasOwn(requirement, "priority")) {
          if (!REQUIREMENT_PRIORITIES.has(requirement.priority)) {
            addError(`${path}.priority`, "must be must or nice");
          }
        }
      });
    }
  }

  let questionIds = new Set();
  if (Array.isArray(kit.questions)) {
    questionIds = uniqueIds(kit.questions, "questions");
    kit.questions.forEach((question, index) => {
      const path = `questions[${index}]`;
      if (!isPlainObject(question)) {
        addError(path, "must be an object");
        return;
      }
      ["id", "requirement_ids", "category", "prompt", "answer_outline", "difficulty"].forEach((field) => {
        if (!hasOwn(question, field)) addError(`${path}.${field}`, "is required");
      });
      if (hasOwn(question, "requirement_ids")) {
        referenceArray(question.requirement_ids, `${path}.requirement_ids`, requirementIds);
      }
      if (hasOwn(question, "category") && !QUESTION_CATEGORIES.has(question.category)) {
        addError(`${path}.category`, "has an invalid value");
      }
      ["prompt", "answer_outline"].forEach((field) => {
        if (hasOwn(question, field)) stringField(question[field], `${path}.${field}`);
      });
      if (hasOwn(question, "difficulty")) integerField(question.difficulty, `${path}.difficulty`, 1);
      if (Number.isInteger(question.difficulty) && question.difficulty > 3) {
        addError(`${path}.difficulty`, "must be an integer between 1 and 3");
      }
    });
  }

  if (Array.isArray(kit.flashcards)) {
    uniqueIds(kit.flashcards, "flashcards");
    kit.flashcards.forEach((flashcard, index) => {
      const path = `flashcards[${index}]`;
      if (!isPlainObject(flashcard)) {
        addError(path, "must be an object");
        return;
      }
      ["id", "front", "back", "requirement_ids"].forEach((field) => {
        if (!hasOwn(flashcard, field)) addError(`${path}.${field}`, "is required");
      });
      ["front", "back"].forEach((field) => {
        if (hasOwn(flashcard, field)) stringField(flashcard[field], `${path}.${field}`);
      });
      if (hasOwn(flashcard, "requirement_ids")) {
        referenceArray(flashcard.requirement_ids, `${path}.requirement_ids`, requirementIds);
      }
    });
  }

  if (isPlainObject(kit.schedule)) {
    if (!hasOwn(kit.schedule, "days_available")) {
      addError("schedule.days_available", "is required");
    } else {
      integerField(kit.schedule.days_available, "schedule.days_available", 1);
    }
    if (!hasOwn(kit.schedule, "days")) {
      addError("schedule.days", "is required");
    } else if (!Array.isArray(kit.schedule.days)) {
      addError("schedule.days", "must be an array");
    } else {
      if (Number.isInteger(kit.schedule.days_available) && kit.schedule.days.length !== kit.schedule.days_available) {
        addError("schedule.days", "must contain exactly days_available entries");
      }
      const dayNumbers = new Set();
      kit.schedule.days.forEach((day, index) => {
        const path = `schedule.days[${index}]`;
        if (!isPlainObject(day)) {
          addError(path, "must be an object");
          return;
        }
        ["day", "focus", "question_ids", "minutes"].forEach((field) => {
          if (!hasOwn(day, field)) addError(`${path}.${field}`, "is required");
        });
        if (hasOwn(day, "day")) {
          integerField(day.day, `${path}.day`, 1);
          if (dayNumbers.has(day.day)) addError(`${path}.day`, "must be unique");
          dayNumbers.add(day.day);
        }
        if (hasOwn(day, "focus")) stringField(day.focus, `${path}.focus`);
        if (hasOwn(day, "question_ids")) referenceArray(day.question_ids, `${path}.question_ids`, questionIds);
        if (hasOwn(day, "minutes")) integerField(day.minutes, `${path}.minutes`, 0);
      });
    }
  }

  if (isPlainObject(kit.coverage)) {
    ["uncovered_requirement_ids", "passes"].forEach((field) => {
      if (!hasOwn(kit.coverage, field)) addError(`coverage.${field}`, "is required");
    });
    if (hasOwn(kit.coverage, "uncovered_requirement_ids")) {
      referenceArray(
        kit.coverage.uncovered_requirement_ids,
        "coverage.uncovered_requirement_ids",
        requirementIds,
      );
    }
    if (hasOwn(kit.coverage, "passes")) integerField(kit.coverage.passes, "coverage.passes", 0);
  }

  if (errors.length > 0) {
    throw new AppError("Kit structure validation failed", "VALIDATION_ERROR", 400, errors);
  }

  return kit;
}

module.exports = {
  validateKitStructure,
};
