// const mongoose = require("mongoose");

// const KanjiSchema = new mongoose.Schema({
//     kanji: { type: String, required: true, unique: true },
//     meaning: { type: String }
// });

// module.exports = mongoose.model("Kanji", KanjiSchema);

const mongoose = require("mongoose");

const KanjiSchema = new mongoose.Schema(
    {
        kanji: { type: String, required: true, unique: true },
        "meaning-fr": [String],
        "meaning-en": [String],
    },
    {
        toObject: { virtuals: true },
        toJSON: { virtuals: true }
    }
);

// Virtual "meaning" à partir de req.lang
KanjiSchema.virtual("meaning").get(function () {
    // Par défaut, on retourne rien ici
    return undefined;
});

module.exports = mongoose.model("Kanji", KanjiSchema);
