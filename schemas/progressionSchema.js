//schemas/progressionSchema.js
const mongoose = require('mongoose');

const ProgressionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' }, // _id MongoDB
    kanji: { type: String, required: true }, // float = Number en JS/Mongoose
    errorCount: { type: Number, required: true, default: 1, min: 0 },
    inProgress: { type: Boolean, required: true, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Progression', ProgressionSchema);
