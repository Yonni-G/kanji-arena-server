const express = require("express");
const router = express.Router();

const { startGame, getClassicCard, getReverseCard, checkAnswer, loadRanking } = require('../controllers/gameController')


// TODO : factoriser

// Route pour le mode classic
router.get('/classic/start', startGame(getClassicCard));
router.post('/classic/checkAnswer', checkAnswer(getClassicCard, 'classic'));
router.get('/classic/ranking', loadRanking('classic'));

// Route pour le mode reverse
router.get('/reverse/start', startGame(getReverseCard));
router.post('/reverse/checkAnswer', checkAnswer(getReverseCard, 'reverse'));
router.get('/reverse/ranking', loadRanking('reverse'));


const { authMiddleware } = require("../middleware/authMiddleware");

module.exports = router;
