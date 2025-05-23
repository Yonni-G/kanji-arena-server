const mongoose = require("mongoose");

const KanjiSchema = new mongoose.Schema({
    kanji: { type: String, required: true, unique: true },
    meaning: { type: String }
});

module.exports = mongoose.model("Kanji", KanjiSchema);