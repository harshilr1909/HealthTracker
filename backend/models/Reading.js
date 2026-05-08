const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema({
  systolic: { type: Number, required: true },
  diastolic: { type: Number, required: true },
  pulse: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  userId: { type: String, default: 'user1' },
  patientName: { type: String, required: true },
});

module.exports = mongoose.model('Reading', readingSchema);
