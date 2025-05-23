// models/ChronoReverse.js
const mongoose = require('mongoose');
const ChronoSchema = require('../schemas/chronoSchema');

module.exports = mongoose.model('ChronoReverse', ChronoSchema, 'chronos_reverse');
