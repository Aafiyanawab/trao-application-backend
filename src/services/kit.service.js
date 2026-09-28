const { ObjectId } = require("mongodb");
const crypto = require("node:crypto");
const { AppError } = require("../utils/errors");

function defaultGetDatabase() {
  return require("../config/database").getDatabase();
}

function pickFields(value, fields) {
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(value, field))
    .map((field) => [field, value[field]]));
}

function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprintGenerationRequest(request) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize({
    generationContext: request.generationContext,
    candidateContext: request.candidateContext ?? null,
    githubContext: request.githubContext ?? null,
    daysAvailable: request.daysAvailable ?? null,
  }))).digest("hex");
}

function normalizeGeneratedItems(kit) {
  const questionFields = ["id", "question", "answer_outline", "category", "difficulty", "rationale", "requirement_ids"];
  const flashcardFields = ["id", "front", "back", "requirement_ids"];
  const normalized = {
    technical_questions: kit.technical_questions.map((item) => pickFields(item, questionFields)),
    non_technical_questions: kit.non_technical_questions.map((item) => pickFields(item, questionFields)),
    interviewer_questions: [...kit.interviewer_questions],
    interview_tips: [...kit.interview_tips],
    follow_up_guidance: [...kit.follow_up_guidance],
    flashcards: kit.flashcards.map((item) => pickFields(item, flashcardFields)),
  };
  for (const section of ["technical_questions", "non_technical_questions", "flashcards"]) {
    normalized[section] = normalized[section].map((item) => ({
      ...item,
      origin: item.origin === "user" ? "user" : "generated",
      edited: item.edited === true,
    }));
  }
  return normalized;
}

function notFound() {
  return new AppError("The requested resource was not found", "NOT_FOUND", 404);
}

function createKitService({
  getDatabase = defaultGetDatabase,
  createKitId = () => new ObjectId().toHexString(),
  now = () => new Date(),
} = {}) {
  let indexesPromise;

  async function getCollection() {
    const collection = getDatabase().collection("kits");
    if (!indexesPromise) {
      indexesPromise = Promise.all([
        collection.createIndex({ userId: 1, kitId: 1 }),
        collection.createIndex({ userId: 1, createdAt: -1 }),
        collection.createIndex(
          { userId: 1, requestFingerprint: 1 },
          { unique: true, partialFilterExpression: { requestFingerprint: { $type: "string" } } },
        ),
      ]).catch((error) => {
        indexesPromise = undefined;
        throw error;
      });
    }
    await indexesPromise;
    return collection;
  }

  async function createKitForUser(userId, { generationContext, pipelineResult, requestFingerprint } = {}) {
    const collection = await getCollection();
    const timestamp = now();
    const kitId = createKitId();
    const title = `${generationContext.company.name} — ${generationContext.role.requested_role}`;
    const document = {
      kitId,
      userId,
      ...(requestFingerprint ? { requestFingerprint } : {}),
      title,
      company: pickFields(generationContext.company, [
        "name", "url", "summary", "what_they_do", "products_services", "industry_domain", "careers_information",
      ]),
      role: pickFields(generationContext.role, [
        "requested_role", "matching_role_found", "job_source", "job_url", "job_title", "public_jd", "user_jd",
      ]),
      requirements: generationContext.requirements.map((requirement) => pickFields(
        requirement,
        ["id", "text", "kind", "priority"],
      )),
      research: generationContext.research,
      kit: normalizeGeneratedItems(pipelineResult.kit),
      practice: {},
      coverage: pipelineResult.coverage,
      schedule: pipelineResult.schedule,
      warnings: pipelineResult.warnings,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      await collection.insertOne(document);
    } catch (error) {
      if (error?.code === 11000 && requestFingerprint) {
        const duplicate = await collection.findOne({ userId, requestFingerprint });
        if (duplicate) return toKitResponse(duplicate);
      }
      throw error;
    }
    return toKitResponse(document);
  }

  async function getKitForRequest(userId, requestFingerprint) {
    const kit = await (await getCollection()).findOne({ userId, requestFingerprint });
    return kit ? toKitResponse(kit) : null;
  }

  async function listKitsForUser(userId) {
    const kits = await (await getCollection())
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    return kits.map(toKitSummary);
  }

  async function getKitForUser(userId, kitId) {
    const kit = await (await getCollection()).findOne({ userId, kitId });
    if (!kit) throw notFound();
    return toKitResponse(kit);
  }

  async function updateKitForUser(userId, kitId, changes, expectedUpdatedAt) {
    const collection = await getCollection();
    const filter = { userId, kitId };
    const existing = await collection.findOne(filter);
    if (!existing) throw notFound();
    if (expectedUpdatedAt && existing.updatedAt?.getTime?.() !== expectedUpdatedAt.getTime()) {
      throw new AppError("The kit changed during this update. Reload and try again.", "KIT_UPDATE_CONFLICT", 409);
    }

    const requestedTimestamp = now();
    const updatedAt = existing.updatedAt && requestedTimestamp.getTime() <= existing.updatedAt.getTime()
      ? new Date(existing.updatedAt.getTime() + 1)
      : requestedTimestamp;
    const result = await collection.updateOne(
      { ...filter, updatedAt: existing.updatedAt },
      { $set: { ...changes, updatedAt } },
    );
    if (result.matchedCount !== 1) {
      throw new AppError("The kit changed during this update. Reload and try again.", "KIT_UPDATE_CONFLICT", 409);
    }

    const updated = await collection.findOne(filter);
    return toKitResponse(updated);
  }

  return { createKitForUser, getKitForRequest, listKitsForUser, getKitForUser, updateKitForUser };
}

function toKitSummary(kit) {
  return {
    id: kit.kitId,
    title: kit.title,
    company: { name: kit.company.name, url: kit.company.url },
    role: { requested_role: kit.role.requested_role },
    createdAt: kit.createdAt,
    updatedAt: kit.updatedAt,
  };
}

function toKitResponse(kit) {
  return {
    id: kit.kitId,
    title: kit.title,
    company: kit.company,
    role: kit.role,
    requirements: kit.requirements,
    research: kit.research,
    kit: kit.kit,
    practice: kit.practice ?? {},
    coverage: kit.coverage,
    schedule: kit.schedule,
    warnings: kit.warnings,
    createdAt: kit.createdAt,
    updatedAt: kit.updatedAt,
  };
}

const defaultService = createKitService();

module.exports = {
  createKitService,
  createKitForUser: defaultService.createKitForUser,
  getKitForRequest: defaultService.getKitForRequest,
  fingerprintGenerationRequest,
  getKitForUser: defaultService.getKitForUser,
  listKitsForUser: defaultService.listKitsForUser,
  updateKitForUser: defaultService.updateKitForUser,
};
