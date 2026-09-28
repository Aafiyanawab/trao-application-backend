const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/trao-auth-test";

function fakeDatabase() {
  const users = [];
  const sessions = [];
  const sessionIndexes = [];
  const kits = [];
  let userSequence = 0;
  const usersCollection = {
    createIndex: async () => {},
    insertOne: async (document) => {
      if (users.some((user) => user.email === document.email)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      const user = { ...structuredClone(document), _id: `user-${++userSequence}` };
      users.push(user);
      return { insertedId: user._id };
    },
    findOne: async (query) => users.find((user) => Object.entries(query).every(([key, value]) => user[key] === value)) ?? null,
    updateOne: async (query, update) => {
      const user = users.find((entry) => Object.entries(query).every(([key, value]) => entry[key] === value));
      if (!user) return { matchedCount: 0 };
      Object.assign(user, structuredClone(update.$set));
      return { matchedCount: 1 };
    },
  };
  const sessionsCollection = {
    createIndex: async (keys, options) => { sessionIndexes.push({ keys, options }); },
    insertOne: async (document) => { sessions.push(structuredClone(document)); return { insertedId: sessions.length }; },
    findOne: async (query) => sessions.find((session) => session.tokenHash === query.tokenHash
      && session.expiresAt > query.expiresAt.$gt) ?? null,
    deleteOne: async (query) => {
      const index = sessions.findIndex((session) => session.tokenHash === query.tokenHash);
      if (index < 0) return { deletedCount: 0 };
      sessions.splice(index, 1);
      return { deletedCount: 1 };
    },
  };
  const kitsCollection = {
    createIndex: async () => {},
    insertOne: async (document) => { kits.push(structuredClone(document)); return { insertedId: document.kitId }; },
    findOne: async (query) => kits.find((kit) => Object.entries(query).every(([key, value]) => kit[key] === value)) ?? null,
    find: (query) => ({
      sort: () => ({ toArray: async () => kits.filter((kit) => kit.userId === query.userId) }),
    }),
    updateOne: async (query, update) => {
      const kit = kits.find((entry) => entry.userId === query.userId
        && entry.kitId === query.kitId && entry.updatedAt === query.updatedAt);
      if (!kit) return { matchedCount: 0 };
      Object.assign(kit, structuredClone(update.$set));
      return { matchedCount: 1 };
    },
  };
  const collections = { users: usersCollection, sessions: sessionsCollection, kits: kitsCollection };
  return {
    database: { collection: (name) => collections[name] },
    users,
    sessions,
    sessionIndexes,
    kits,
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send() { return this; },
  };
}

function loadAuthModules(database) {
  const databaseConfig = require("../src/config/database");
  databaseConfig.getDatabase = () => database;
  for (const path of [
    "../src/services/auth.service",
    "../src/controllers/auth.controller",
    "../src/middleware/auth.middleware",
  ]) {
    delete require.cache[require.resolve(path)];
  }
  return {
    service: require("../src/services/auth.service"),
    controller: require("../src/controllers/auth.controller"),
    middleware: require("../src/middleware/auth.middleware"),
  };
}

function tokenFromCookie(header) {
  return decodeURIComponent(header.match(/trao_session=([^;]*)/)[1]);
}

test("covers registration, hashed credentials, sessions, logout, and owner-scoped kit access offline", async () => {
  const { database, users, sessions, kits, sessionIndexes } = fakeDatabase();
  const { service, controller, middleware } = loadAuthModules(database);

  const registrationResponse = response();
  await controller.register({ body: { email: "candidate@example.test", password: "correct horse battery staple" } }, registrationResponse);
  assert.equal(registrationResponse.statusCode, 201);
  assert.equal(registrationResponse.body.user.email, "candidate@example.test");
  assert.equal(Object.hasOwn(registrationResponse.body.user, "passwordHash"), false);
  assert.equal(Object.hasOwn(registrationResponse.body.user, "passwordSalt"), false);
  assert.equal(users.length, 1);
  assert.notEqual(users[0].passwordHash, "correct horse battery staple");
  assert.equal(users[0].passwordHash.length, 128);
  assert.equal(users[0].passwordSalt.length, 32);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessionIndexes, [
    { keys: { tokenHash: 1 }, options: { unique: true } },
    { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]);

  const registrationToken = tokenFromCookie(registrationResponse.headers["Set-Cookie"]);
  const registrationHash = crypto.createHash("sha256").update(registrationToken).digest("hex");
  assert.equal(sessions[0].tokenHash, registrationHash);
  assert.notEqual(sessions[0].tokenHash, registrationToken);
  assert.equal(Object.hasOwn(sessions[0], "token"), false);

  await assert.rejects(
    controller.register({ body: { email: "candidate@example.test", password: "another password" } }, response()),
    (error) => error.code === "CONFLICT" && error.statusCode === 409,
  );
  assert.equal(users.length, 1);

  const loginResponse = response();
  await controller.login({ body: { email: "candidate@example.test", password: "correct horse battery staple" } }, loginResponse);
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.user.id, users[0]._id);
  assert.equal(sessions.length, 2);
  await assert.rejects(
    controller.login({ body: { email: "candidate@example.test", password: "wrong password" } }, response()),
    (error) => error.code === "INVALID_CREDENTIALS" && error.statusCode === 401,
  );
  await assert.rejects(
    controller.login({ body: { email: "missing@example.test", password: "wrong password" } }, response()),
    (error) => error.code === "INVALID_CREDENTIALS" && error.statusCode === 401,
  );
  assert.equal(sessions.length, 2);

  let authenticatedRequest;
  let middlewareError;
  const request = { headers: { cookie: `trao_session=${encodeURIComponent(registrationToken)}` } };
  await middleware.requireAuth(request, {}, (error) => { middlewareError = error; });
  authenticatedRequest = request;
  assert.equal(middlewareError, undefined);
  assert.equal(authenticatedRequest.user._id, users[0]._id);
  assert.equal(authenticatedRequest.sessionToken, registrationToken);

  const secondRegistration = response();
  await controller.register({ body: { email: "other@example.test", password: "other password" } }, secondRegistration);
  const otherUser = await service.getUserBySessionToken(tokenFromCookie(secondRegistration.headers["Set-Cookie"]));
  assert.ok(otherUser);

  const { createKitService } = require("../src/services/kit.service");
  const kitService = createKitService({ getDatabase: () => database, createKitId: () => "persisted-kit-1" });
  const generationContext = {
    company: { name: "Acme", url: "https://acme.example.test" },
    role: { requested_role: "Engineer", user_jd: "Build APIs." },
    requirements: [],
  };
  const pipelineResult = {
    kit: {
      technical_questions: [], non_technical_questions: [], flashcards: [],
      interviewer_questions: [], interview_tips: [], follow_up_guidance: [],
    },
    coverage: {}, schedule: {}, warnings: [],
  };
  const savedKit = await kitService.createKitForUser(authenticatedRequest.user._id, { generationContext, pipelineResult });
  assert.equal((await kitService.getKitForUser(authenticatedRequest.user._id, savedKit.id)).id, savedKit.id);
  const originalSummary = kits[0].company.summary;
  await assert.rejects(kitService.getKitForUser(otherUser._id, savedKit.id), (error) => error.code === "NOT_FOUND");
  await assert.rejects(
    kitService.updateKitForUser(otherUser._id, savedKit.id, { company: { summary: "forged" } }),
    (error) => error.code === "NOT_FOUND",
  );
  assert.equal(kits[0].company.summary, originalSummary);

  const expiredSession = sessions.find((session) => session.tokenHash === registrationHash);
  expiredSession.expiresAt = new Date(0);
  for (const invalidToken of [registrationToken, "invalid-token", undefined]) {
    const invalidRequest = { headers: invalidToken ? { cookie: `trao_session=${encodeURIComponent(invalidToken)}` } : {} };
    let authError;
    await middleware.requireAuth(invalidRequest, {}, (error) => { authError = error; });
    assert.equal(authError.code, "UNAUTHORIZED");
    assert.equal(authError.statusCode, 401);
  }

  const logoutToken = tokenFromCookie(loginResponse.headers["Set-Cookie"]);
  const logoutResponse = response();
  await controller.logout({ sessionToken: logoutToken }, logoutResponse);
  assert.equal(logoutResponse.statusCode, 204);
  assert.match(logoutResponse.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal(await service.getUserBySessionToken(logoutToken), null);
});

test("upgrades a legacy default-cost scrypt hash after successful login", async () => {
  const { database, users } = fakeDatabase();
  const { service } = loadAuthModules(database);
  const legacy = await service.hashPassword("legacy password", "0123456789abcdef", 1);
  users.push({ _id: "legacy-user", email: "legacy@example.test", ...legacy, createdAt: new Date() });
  delete users[0].passwordHashVersion;
  const result = await service.login("legacy@example.test", "legacy password");
  assert.equal(result.user.id, "legacy-user");
  assert.equal(users[0].passwordHashVersion, 2);
  assert.notEqual(users[0].passwordHash, legacy.passwordHash);
  assert.equal(await service.passwordsMatch("legacy password", users[0]), true);
  assert.equal(await service.passwordsMatch("wrong password", users[0]), false);
});

test("malformed encoded session cookie is treated as unauthenticated", async () => {
  const { database } = fakeDatabase();
  const { middleware } = loadAuthModules(database);
  let error;
  await middleware.requireAuth({ headers: { cookie: "trao_session=%E0%A4%A" } }, {}, (nextError) => { error = nextError; });
  assert.equal(error.code, "UNAUTHORIZED");
  assert.equal(error.statusCode, 401);
});
