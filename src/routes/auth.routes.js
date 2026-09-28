const express = require("express");

const authController = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { createOriginGuard, createRateLimiter, requestIp } = require("../middleware/request-protection.middleware");

const router = express.Router();
const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, key: requestIp });
const originGuard = createOriginGuard();

router.post("/register", originGuard, authRateLimit, authController.register);
router.post("/login", originGuard, authRateLimit, authController.login);
router.post("/logout", requireAuth, originGuard, authController.logout);
router.get("/me", requireAuth, authController.me);

module.exports = router;
