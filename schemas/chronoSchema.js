//schemas/chronoSchema.js
const mongoose = require('mongoose');
const JlptGrade = require('../models/JlptGrade');

const ChronoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' }, // _id MongoDB
    chrono: { type: Number, required: true }, // float = Number en JS/Mongoose
    jlpt: { type: JlptGrade, required: true },
    createdAt: { type: Date, required: true, default: Date.now } // date avec l'heure
});

module.exports = ChronoSchema;
