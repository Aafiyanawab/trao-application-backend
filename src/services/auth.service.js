const crypto = require("crypto");
const { promisify } = require("util");

const { getDatabase } = require("../config/database");
const { AppError } = require("../utils/errors");

const scrypt = promisify(crypto.scrypt);
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH_VERSION = 2;
const PASSWORD_HASH_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 });
const LEGACY_PASSWORD_HASH_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
let sessionIndexesPromise;

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), version = PASSWORD_HASH_VERSION) {
  const options = version === PASSWORD_HASH_VERSION ? PASSWORD_HASH_OPTIONS : LEGACY_PASSWORD_HASH_OPTIONS;
  const derivedKey = await scrypt(password, salt, 64, options);
  return { passwordHash: derivedKey.toString("hex"), passwordSalt: salt, passwordHashVersion: version };
}

async function passwordsMatch(password, user) {
  const version = user.passwordHashVersion ?? 1;
  const { passwordHash } = await hashPassword(password, user.passwordSalt, version);
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(passwordHash, "hex");

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function ensureSessionIndexes(database) {
  if (!sessionIndexesPromise) {
    sessionIndexesPromise = Promise.all([
      database.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
      database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((error) => {
      sessionIndexesPromise = undefined;
      throw error;
    });
  }
  return sessionIndexesPromise;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const database = getDatabase();
  await ensureSessionIndexes(database);

  await database.collection("sessions").insertOne({
    tokenHash: hashSessionToken(token),
    userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  });

  return token;
}

async function register(email, password) {
  const database = getDatabase();
  const users = database.collection("users");
  await users.createIndex({ email: 1 }, { unique: true });

  const passwordData = await hashPassword(password);
  const user = {
    email,
    ...passwordData,
    passwordHashVersion: PASSWORD_HASH_VERSION,
    createdAt: new Date(),
  };

  try {
    const result = await users.insertOne(user);
    user._id = result.insertedId;
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("An account with this email already exists", "CONFLICT", 409);
    }
    throw error;
  }

  return {
    user: toPublicUser(user),
    token: await createSession(user._id),
  };
}

async function login(email, password) {
  const database = getDatabase();
  const user = await database.collection("users").findOne({ email });

  if (!user || !(await passwordsMatch(password, user))) {
    throw new AppError("Invalid email or password", "INVALID_CREDENTIALS", 401);
  }

  if (user.passwordHashVersion === undefined) {
    const upgraded = await hashPassword(password);
    await database.collection("users").updateOne(
      { _id: user._id, passwordHash: user.passwordHash, passwordSalt: user.passwordSalt },
      { $set: upgraded },
    );
  }

  return {
    user: toPublicUser(user),
    token: await createSession(user._id),
  };
}

async function getUserBySessionToken(token) {
  if (!token) {
    return null;
  }

  const database = getDatabase();
  const session = await database.collection("sessions").findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    return null;
  }

  return database.collection("users").findOne({ _id: session.userId });
}

async function deleteSession(token) {
  if (!token) {
    return;
  }

  await getDatabase().collection("sessions").deleteOne({
    tokenHash: hashSessionToken(token),
  });
}

module.exports = {
  register,
  login,
  getUserBySessionToken,
  deleteSession,
  hashPassword,
  passwordsMatch,
  ensureSessionIndexes,
  PASSWORD_HASH_OPTIONS,
  LEGACY_PASSWORD_HASH_OPTIONS,
};
