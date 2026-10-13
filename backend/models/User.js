const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Legacy field (kept for old accounts). New accounts use hospitalId.
  username: { type: String, unique: true, sparse: true },
  // Canonical doctor identity — unique per doctor.
  hospitalId: { type: String, unique: true, sparse: true },
  name: { type: String },
  password: { type: String, required: true },
  readings: {type:mongoose.Schema.Types.ObjectId, ref:'Reading'},
});

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
