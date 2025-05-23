// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const { register, login, logout, forgotPassword, resetPassword, checkRefreshToken, checkResetToken, setAlertOutOfRanking } = require("../controllers/userController");

// routes non-protégées
router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// routes de gestion des tokens
// ici j'utilise le verbe GET parce sinon le cookie http only refreshToken n'était pas envoyé ...
router.get("/check-refresh-token", checkRefreshToken);
router.post("/check-reset-token", checkResetToken);

// ROUTES PROTEGEES

// profil utilisateur
router.post("/set-alert-out-of-ranking", setAlertOutOfRanking, authMiddleware);

module.exports = router;