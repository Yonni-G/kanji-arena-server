
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const { myLearningSpace } = require("../controllers/myLearningSpaceController");

// ROUTES PROTEGEES
router.get("/my-learning-space", myLearningSpace, authMiddleware);

module.exports = router;