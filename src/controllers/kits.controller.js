const kitService = require("../services/kit.service");
const { generateWithCoverageAndSchedule } = require("../services/coverage-schedule.service");
const { generateInterviewKit } = require("../services/interview-generation.service");
const { validateGeneratedInterviewKit } = require("../services/generated-kit-validation.service");
const { checkCoverage } = require("../services/coverage.service");
const { allocateSchedule } = require("../services/schedule.service");
const { AppError } = require("../utils/errors");
const { validateObjectId } = require("../utils/validation");
const crypto = require("node:crypto");

const QUESTION_SECTIONS = ["technical_questions", "non_technical_questions"];
const ITEM_SECTIONS = [...QUESTION_SECTIONS, "flashcards"];
const BRIEF_FIELDS = ["summary", "what_they_do", "products_services", "industry_domain", "careers_information"];
const QUESTION_FIELDS = ["question", "category", "difficulty", "rationale", "requirement_ids"];
const FLASHCARD_FIELDS = ["front", "back", "requirement_ids"];
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:GEMINI_API_KEY|GITHUB_TOKEN|API_KEY|ACCESS_TOKEN|SECRET_KEY)\s*[:=]\s*["']?[A-Za-z0-9/+_.=-]{12,}/i,
];

function validationError(path, message) {
  return new AppError("Kit update is invalid", "VALIDATION_ERROR", 400, [{ path, message }]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, path) {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) throw validationError(`${path}.${field}`, "is not supported");
  }
}

function assertSafeText(value, path) {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    throw validationError(path, "must not contain credentials or secrets");
  }
}

function validateKitForEditing(kit, requirements) {
  validateGeneratedInterviewKit(kit, { generationContext: { requirements } });
  const seenIds = new Set();
  for (const section of ITEM_SECTIONS) {
    for (const item of kit[section]) {
      if (seenIds.has(item.id)) throw validationError(`${section}.id`, "must be unique across editable items");
      seenIds.add(item.id);
      if (!["generated", "user"].includes(item.origin) || typeof item.edited !== "boolean") {
        throw validationError(`${section}.metadata`, "origin and edited state are invalid");
      }
      const requirementIds = new Set();
      item.requirement_ids.forEach((id) => {
        if (requirementIds.has(id)) throw validationError(`${section}.requirement_ids`, "must not contain duplicates");
        requirementIds.add(id);
      });
    }
  }
}

function questionsIn(kit) {
  return [...kit.technical_questions, ...kit.non_technical_questions];
}

function buildQuestionPlan(kit, requirements, currentCoverage, currentSchedule) {
  const coverageResult = checkCoverage(
    { role: { requirements }, questions: questionsIn(kit) },
    currentCoverage?.passes ?? 1,
  );
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const uncoveredMust = coverageResult.uncovered_requirement_ids.filter(
    (id) => requirementById.get(id)?.priority === "must",
  );
  if (uncoveredMust.length > 0) {
    throw new AppError("The edit would leave must-have requirements uncovered", "KIT_COVERAGE_ERROR", 422, [
      { path: "kit.questions", message: `must requirements are uncovered: ${uncoveredMust.join(", ")}` },
    ]);
  }
  const daysAvailable = currentSchedule?.days_available ?? currentSchedule?.days?.length;
  const schedule = allocateSchedule(questionsIn(kit), requirements, daysAvailable);
  const uncoveredNice = coverageResult.uncovered_requirement_ids.filter(
    (id) => requirementById.get(id)?.priority === "nice",
  );
  return {
    coverage: {
      requirements,
      ...coverageResult,
      uncovered_must_requirement_ids: [],
      uncovered_nice_requirement_ids: uncoveredNice,
    },
    schedule,
  };
}

function createKitsController({
  service = kitService,
  generate = generateWithCoverageAndSchedule,
  generateSection = generateInterviewKit,
  validate = validateGeneratedInterviewKit,
  schedule = allocateSchedule,
  createItemId = () => crypto.randomUUID(),
  now = () => new Date(),
} = {}) {
  async function listKits(req, res) {
    const kits = await service.listKitsForUser(req.user._id);
    res.json({ items: kits });
  }

  async function createKit(req, res) {
    const body = req.body ?? {};
    const pipelineResult = await generate({
      generationContext: body.generationContext,
      candidateContext: body.candidateContext,
      githubContext: body.githubContext,
      daysAvailable: body.daysAvailable,
    });
    if (!pipelineResult?.schedule || !pipelineResult.coverage?.all_must_requirements_covered) {
      throw new AppError("The interview kit is incomplete and cannot be saved", "INCOMPLETE_KIT", 422);
    }
    const savedKit = await service.createKitForUser(req.user._id, {
      generationContext: body.generationContext,
      pipelineResult,
    });
    res.status(201).json({ kit: savedKit });
  }

  async function getKit(req, res) {
    validateObjectId(req.params.id, "kitId");
    const kit = await service.getKitForUser(req.user._id, req.params.id);
    res.json({ kit });
  }

  async function updateKit(req, res) {
    validateObjectId(req.params.id, "kitId");
    const body = req.body;
    if (!isPlainObject(body)) throw validationError("body", "must be an object");
    const existing = await service.getKitForUser(req.user._id, req.params.id);
    const kit = structuredClone(existing.kit);
    let changes;

    if (body.operation === "edit") {
      if (body.section === "company") {
        rejectUnknownFields(body, ["operation", "section", "changes"], "body");
        if (!isPlainObject(body.changes) || Object.keys(body.changes).length === 0) {
          throw validationError("body.changes", "must be a non-empty object");
        }
        rejectUnknownFields(body.changes, BRIEF_FIELDS, "body.changes");
        const company = { ...existing.company };
        for (const [field, value] of Object.entries(body.changes)) {
          if (typeof value !== "string") throw validationError(`body.changes.${field}`, "must be a string");
          assertSafeText(value, `body.changes.${field}`);
          company[field] = value;
        }
        changes = { company };
      } else {
        if (!ITEM_SECTIONS.includes(body.section)) throw validationError("body.section", "is not editable");
        rejectUnknownFields(body, ["operation", "section", "itemId", "changes"], "body");
        if (typeof body.itemId !== "string" || !isPlainObject(body.changes) || Object.keys(body.changes).length === 0) {
          throw validationError("body", "itemId and non-empty changes are required");
        }
        const item = kit[body.section].find((entry) => entry.id === body.itemId);
        if (!item) throw new AppError("The requested item was not found", "NOT_FOUND", 404);
        rejectUnknownFields(body.changes, body.section === "flashcards" ? FLASHCARD_FIELDS : QUESTION_FIELDS, "body.changes");
        kit[body.section] = kit[body.section].map((entry) => entry.id === body.itemId
          ? { ...entry, ...body.changes, edited: true }
          : entry);
        validateKitForEditing(kit, existing.requirements);
        changes = { kit };
        if (body.section !== "flashcards") Object.assign(changes, buildQuestionPlan(kit, existing.requirements, existing.coverage, existing.schedule));
      }
    } else if (body.operation === "reorder") {
      rejectUnknownFields(body, ["operation", "section", "itemIds"], "body");
      if (!ITEM_SECTIONS.includes(body.section) || !Array.isArray(body.itemIds)) {
        throw validationError("body", "a supported section and itemIds array are required");
      }
      const current = kit[body.section];
      const currentIds = new Set(current.map((item) => item.id));
      const requestedIds = new Set(body.itemIds);
      if (body.itemIds.some((id) => typeof id !== "string") || requestedIds.size !== body.itemIds.length) {
        throw validationError("body.itemIds", "must contain unique item IDs");
      }
      if (requestedIds.size !== currentIds.size || [...requestedIds].some((id) => !currentIds.has(id))) {
        throw validationError("body.itemIds", "must list every existing item exactly once");
      }
      const itemsById = new Map(current.map((item) => [item.id, item]));
      kit[body.section] = body.itemIds.map((id) => itemsById.get(id));
      validateKitForEditing(kit, existing.requirements);
      changes = { kit };
    } else if (body.operation === "add") {
      rejectUnknownFields(body, ["operation", "section", "item"], "body");
      if (!ITEM_SECTIONS.includes(body.section) || !isPlainObject(body.item)) {
        throw validationError("body", "a supported section and item object are required");
      }
      const allowed = body.section === "flashcards" ? FLASHCARD_FIELDS : QUESTION_FIELDS;
      rejectUnknownFields(body.item, allowed, "body.item");
      const item = {
        ...body.item,
        id: createItemId(),
        origin: "user",
        edited: true,
      };
      kit[body.section] = [...kit[body.section], item];
      validateKitForEditing(kit, existing.requirements);
      changes = { kit };
      if (body.section !== "flashcards") Object.assign(changes, buildQuestionPlan(kit, existing.requirements, existing.coverage, existing.schedule));
    } else if (body.operation === "move") {
      rejectUnknownFields(body, ["operation", "itemId", "fromSection", "toSection", "category"], "body");
      if (!QUESTION_SECTIONS.includes(body.fromSection) || !QUESTION_SECTIONS.includes(body.toSection)
        || body.fromSection === body.toSection || typeof body.itemId !== "string" || typeof body.category !== "string") {
        throw validationError("body", "itemId, distinct question sections, and a category are required");
      }
      const sourceItem = kit[body.fromSection].find((item) => item.id === body.itemId);
      if (!sourceItem) throw new AppError("The requested item was not found", "NOT_FOUND", 404);
      kit[body.fromSection] = kit[body.fromSection].filter((item) => item.id !== body.itemId);
      kit[body.toSection] = [...kit[body.toSection], { ...sourceItem, category: body.category, edited: true }];
      validateKitForEditing(kit, existing.requirements);
      changes = { kit, ...buildQuestionPlan(kit, existing.requirements, existing.coverage, existing.schedule) };
    } else {
      throw validationError("body.operation", "must be edit, reorder, add, or move");
    }

    const updated = await service.updateKitForUser(req.user._id, req.params.id, changes, existing.updatedAt);
    res.json({ kit: updated });
  }

  async function deleteItem(req, res) {
    validateObjectId(req.params.id, "kitId");
    const section = req.query.section;
    if (!ITEM_SECTIONS.includes(section)) throw validationError("query.section", "is not deletable");
    const existing = await service.getKitForUser(req.user._id, req.params.id);
    const kit = structuredClone(existing.kit);
    const items = kit[section];
    if (!items.some((item) => item.id === req.params.itemId)) {
      throw new AppError("The requested item was not found", "NOT_FOUND", 404);
    }
    kit[section] = items.filter((item) => item.id !== req.params.itemId);
    validateKitForEditing(kit, existing.requirements);
    const changes = { kit };
    if (section !== "flashcards") Object.assign(changes, buildQuestionPlan(kit, existing.requirements, existing.coverage, existing.schedule));
    const updated = await service.updateKitForUser(req.user._id, req.params.id, changes, existing.updatedAt);
    res.json({ kit: updated });
  }

  async function regenerateSection(req, res) {
    validateObjectId(req.params.id, "kitId");
    const body = req.body;
    if (!isPlainObject(body) || typeof body.section !== "string") {
      throw validationError("body.section", "is required");
    }
    const existing = await service.getKitForUser(req.user._id, req.params.id);
    const kit = structuredClone(existing.kit);
    const generationContext = {
      company: existing.company,
      role: existing.role,
      requirements: existing.requirements,
      research: existing.research ?? { sources: [], pages_used: [], research_gaps: [], warnings: [] },
    };
    let changes;

    if (body.section === "schedule") {
      rejectUnknownFields(body, ["section", "daysAvailable"], "body");
      const daysAvailable = body.daysAvailable ?? existing.schedule?.days_available;
      const newSchedule = schedule(questionsIn(kit), existing.requirements, daysAvailable);
      changes = { schedule: newSchedule };
    } else {
      const supported = [...QUESTION_SECTIONS, "flashcards", "company_brief"];
      if (!supported.includes(body.section)) throw validationError("body.section", "is not regeneratable");
      rejectUnknownFields(body, ["section", "candidateContext", "githubContext"], "body");
      const preservedItems = body.section === "company_brief"
        ? []
        : kit[body.section].filter((item) => item.origin === "user" || item.edited === true);
      const generated = await generateSection(
        generationContext,
        body.candidateContext,
        body.githubContext,
        { sectionRegeneration: { section: body.section, preservedItems } },
      );
      validate(generated, { generationContext });

      if (body.section === "company_brief") {
        if (!isPlainObject(generated.company_brief)) throw validationError("generated.company_brief", "must be an object");
        rejectUnknownFields(generated.company_brief, BRIEF_FIELDS, "generated.company_brief");
        if (BRIEF_FIELDS.some((field) => typeof generated.company_brief[field] !== "string")) {
          throw validationError("generated.company_brief", "must include all supported brief fields as strings");
        }
        for (const [field, value] of Object.entries(generated.company_brief)) assertSafeText(value, `generated.company_brief.${field}`);
        changes = { company: { ...existing.company, ...generated.company_brief } };
      } else {
        const allowedGeneratedFields = body.section === "flashcards"
          ? ["id", ...FLASHCARD_FIELDS]
          : ["id", ...QUESTION_FIELDS];
        generated[body.section].forEach((item, index) => {
          rejectUnknownFields(item, allowedGeneratedFields, `generated.${body.section}[${index}]`);
        });
        for (const section of [...ITEM_SECTIONS, ...[...QUESTION_SECTIONS].filter((item) => item !== body.section)]) {
          if (section !== body.section && generated[section]?.length !== 0) {
            throw validationError(`generated.${section}`, "must be empty when regenerating another section");
          }
        }
        const usedIds = new Set(
          ITEM_SECTIONS.filter((section) => section !== body.section)
            .flatMap((section) => kit[section].map((item) => item.id)),
        );
        preservedItems.forEach((item) => usedIds.add(item.id));
        const preservedContent = new Set(preservedItems.map((item) => body.section === "flashcards"
          ? `${item.front.trim().toLowerCase().replace(/\s+/g, " ")}\u0000${item.back.trim().toLowerCase().replace(/\s+/g, " ")}`
          : item.question.trim().toLowerCase().replace(/\s+/g, " ")));
        const generatedItems = generated[body.section].flatMap((item, index) => {
          const contentKey = body.section === "flashcards"
            ? `${item.front.trim().toLowerCase().replace(/\s+/g, " ")}\u0000${item.back.trim().toLowerCase().replace(/\s+/g, " ")}`
            : item.question.trim().toLowerCase().replace(/\s+/g, " ");
          if (preservedContent.has(contentKey)) return [];
          let id = item.id;
          if (usedIds.has(id)) {
            id = createItemId();
            while (typeof id === "string" && id.trim() !== "" && usedIds.has(id)) id = createItemId();
          }
          if (typeof id !== "string" || id.trim() === "" || usedIds.has(id)) {
            throw validationError(`generated.${body.section}[${index}].id`, "must be unique and non-empty");
          }
          usedIds.add(id);
          return [{ ...item, id, origin: "generated", edited: false }];
        });
        kit[body.section] = [...generatedItems, ...preservedItems];
        validateKitForEditing(kit, existing.requirements);
        changes = { kit };
      }
    }

    const updated = await service.updateKitForUser(req.user._id, req.params.id, changes, existing.updatedAt);
    res.json({ kit: updated });
  }

  async function getPracticeSession(req, res) {
    validateObjectId(req.params.id, "kitId");
    const existing = await service.getKitForUser(req.user._id, req.params.id);
    const practice = existing.practice ?? {};
    const items = existing.kit.flashcards.map((flashcard, index) => {
      const record = practice[flashcard.id];
      return {
        flashcard: {
          id: flashcard.id,
          front: flashcard.front,
          back: flashcard.back,
          requirement_ids: [...flashcard.requirement_ids],
        },
        covered: Boolean(record),
        confidence: record?.confidence ?? null,
        lastPracticedAt: record?.lastPracticedAt ?? null,
        stableOrder: index,
      };
    });

    // Deterministic next-session priority: uncovered first, then lowest confidence,
    // oldest practice time, and finally the flashcard's stable kit order.
    items.sort((left, right) => {
      if (left.covered !== right.covered) return left.covered ? 1 : -1;
      if (left.covered && left.confidence !== right.confidence) return left.confidence - right.confidence;
      if (left.covered) {
        const leftTime = new Date(left.lastPracticedAt).getTime();
        const rightTime = new Date(right.lastPracticedAt).getTime();
        if (leftTime !== rightTime) return leftTime - rightTime;
      }
      return left.stableOrder - right.stableOrder;
    });

    res.json({ items: items.map(({ stableOrder, ...item }) => item) });
  }

  async function recordPracticeConfidence(req, res) {
    validateObjectId(req.params.id, "kitId");
    const flashcardId = req.params.flashcardId;
    if (typeof flashcardId !== "string" || flashcardId.trim() === "" || flashcardId.length > 200) {
      throw validationError("flashcardId", "must be a valid flashcard ID");
    }
    if (!isPlainObject(req.body)) throw validationError("body", "must be an object");
    rejectUnknownFields(req.body, ["confidence"], "body");
    const confidence = req.body.confidence;
    if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
      throw validationError("body.confidence", "must be an integer from 1 to 5");
    }

    const existing = await service.getKitForUser(req.user._id, req.params.id);
    if (!existing.kit.flashcards.some((flashcard) => flashcard.id === flashcardId)) {
      throw new AppError("The requested flashcard was not found", "NOT_FOUND", 404);
    }
    const practice = structuredClone(existing.practice ?? {});
    const lastPracticedAt = new Date(now());
    practice[flashcardId] = { confidence, covered: true, lastPracticedAt };
    const updated = await service.updateKitForUser(req.user._id, req.params.id, { practice }, existing.updatedAt);
    res.json({ practice: updated.practice[flashcardId] });
  }

  function deleteKit(req, res, next) {
    next(new AppError("Deleting entire kits is not implemented", "NOT_IMPLEMENTED", 501));
  }

  return {
    listKits,
    createKit,
    getKit,
    updateKit,
    deleteItem,
    regenerateSection,
    getPracticeSession,
    recordPracticeConfidence,
    deleteKit,
  };
}

const defaultController = createKitsController();

module.exports = {
  createKitsController,
  ...defaultController,
};
