// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const { register, login, forgotPassword, resetPassword, checkResetToken, setAlertOutOfRanking, getAlertOutOfRanking } = require("../controllers/userController");

// routes non-protégées
router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// routes de gestion des tokens
router.post("/check-reset-token", checkResetToken);

// ROUTES PROTEGEES
// profil utilisateur
router.post("/set-alert-out-of-ranking", setAlertOutOfRanking, authMiddleware);
router.get("/get-alert-out-of-ranking", getAlertOutOfRanking, authMiddleware);

module.exports = router;