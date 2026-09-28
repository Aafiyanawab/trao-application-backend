const express = require("express");

const kitsController = require("../controllers/kits.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { createOriginGuard, createRateLimiter, requestUser } = require("../middleware/request-protection.middleware");

const router = express.Router();

router.use(requireAuth);
router.use(createOriginGuard());
const generationRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 4, key: requestUser });
router.get("/", kitsController.listKits);
router.post("/", generationRateLimit, kitsController.createKit);
router.get("/:id/practice", kitsController.getPracticeSession);
router.post("/:id/practice/:flashcardId", kitsController.recordPracticeConfidence);
router.get("/:id", kitsController.getKit);
router.patch("/:id", kitsController.updateKit);
router.post("/:id/regenerate", generationRateLimit, kitsController.regenerateSection);
router.delete("/:id/items/:itemId", kitsController.deleteItem);
router.delete("/:id", kitsController.deleteKit);

module.exports = router;
