const authService = require("../services/auth.service");
const {
  validateLoginPayload,
  validateRegisterPayload,
} = require("../utils/validation");
const { SESSION_COOKIE } = require("../middleware/auth.middleware");

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function register(req, res) {
  const { email, password } = validateRegisterPayload(req.body);
  const result = await authService.register(email, password);

  setSessionCookie(res, result.token);
  res.status(201).json({ user: result.user });
}

async function login(req, res) {
  const { email, password } = validateLoginPayload(req.body);
  const result = await authService.login(email, password);

  setSessionCookie(res, result.token);
  res.json({ user: result.user });
}

async function logout(req, res) {
  await authService.deleteSession(req.sessionToken);
  clearSessionCookie(res);
  res.status(204).send();
}

function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

module.exports = {
  register,
  login,
  logout,
  me,
};
