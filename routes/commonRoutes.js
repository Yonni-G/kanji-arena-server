const express = require("express");
const router = express.Router();
const { sendContactMessage } = require("../controllers/commonController");

router.post('/contact/send', sendContactMessage);

module.exports = router;
