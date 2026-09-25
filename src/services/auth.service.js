const crypto = require("crypto");
const { promisify } = require("util");

const { getDatabase } = require("../config/database");
const { AppError } = require("../utils/errors");

const scrypt = promisify(crypto.scrypt);
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derivedKey = await scrypt(password, salt, 64);
  return { passwordHash: derivedKey.toString("hex"), passwordSalt: salt };
}

async function passwordsMatch(password, user) {
  const { passwordHash } = await hashPassword(password, user.passwordSalt);
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(passwordHash, "hex");

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const database = getDatabase();

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
};
