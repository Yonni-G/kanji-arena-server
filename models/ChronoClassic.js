// models/ChronoClassic.js
const mongoose = require('mongoose');
const ChronoSchema = require('../schemas/chronoSchema');

module.exports = mongoose.model('ChronoClassic', ChronoSchema, 'chronos_classic');
