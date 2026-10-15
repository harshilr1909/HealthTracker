require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Reading = require('./models/Reading');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/beurer_data';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ESP32_API_KEY = process.env.ESP32_API_KEY || 'esp32-secret-123';

app.use(cors());
app.use(express.json());

// Serve Static Files from Frontend
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ---- ESP32 Direct WiFi ingest (additive; existing auth/readings logic untouched) ----
app.post('/api/esp32/reading', async (req, res) => {
  try {
    const apiKey = req.header('X-API-Key');
    if (apiKey !== ESP32_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const { systolic, diastolic, pulse, patientName, timestamp } = req.body;
    const newReading = new Reading({
      systolic,
      diastolic,
      pulse,
      patientName: (patientName || 'ESP32_Device').toString().trim(),
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      userId: 'esp32_device',
    });
    await newReading.save();
    res.status(201).json({ message: 'ESP32 reading saved' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Register Route — doctors identified by hospitalId (plus display name + password)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, hospitalId, password, username } = req.body;
    const id = (hospitalId || username || '').trim();
    if (!id || !password || !String(req.body.name || '').trim() && !hospitalId) {
      return res.status(400).json({ error: 'Name, Hospital ID and password are required' });
    }
    console.log(`Attempting to register doctor: ${id}`);
    const existingUser = await User.findOne({
      $or: [{ hospitalId: id }, { username: id }],
    });
    if (existingUser) return res.status(400).json({ error: 'Hospital ID already registered' });

    const user = new User({
      name: String(name || '').trim(),
      hospitalId: id,
      username: id, // keep legacy field in sync for old clients
      password,
    });
    await user.save();
    console.log('Doctor saved successfully');
    res.status(201).json({ message: 'Doctor registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Login Route — by hospitalId (falls back to legacy username)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { hospitalId, username, password } = req.body;
    const id = (hospitalId || username || '').trim();
    if (!id || !password) return res.status(400).json({ error: 'Hospital ID and password are required' });
    const user = await User.findOne({
      $or: [{ hospitalId: id }, { username: id }],
    });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({
      token,
      doctor: {
        name: user.name || user.username || '',
        hospitalId: user.hospitalId || user.username || '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current doctor profile (for "Signed in as…" header, survives reload)
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Doctor not found' });
    res.json({
      name: user.name || user.username || '',
      hospitalId: user.hospitalId || user.username || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: de-dupe check — same doctor + patient + values + exact timestamp
async function findDuplicate({ userId, patientName, systolic, diastolic, pulse, timestamp }) {
  return Reading.findOne({
    userId,
    patientName: { $regex: `^${patientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    systolic,
    diastolic,
    pulse,
    timestamp,
  });
}

// Route to save multiple readings (Bulk, Protected, scoped to doctor)
// Kept for backwards-compat. New client sends latest-only single POST.
app.post('/api/readings/bulk', auth, async (req, res) => {
  try {
    const userId = String(req.user.userId);
    const readings = req.body;
    if (!Array.isArray(readings)) {
      return res.status(400).json({ error: 'Expected an array of readings' });
    }

    const saved = [];
    const skipped = [];
    for (const r of readings) {
      if (!r.patientName) { skipped.push(r); continue; }
      const doc = {
        systolic: r.systolic,
        diastolic: r.diastolic,
        pulse: r.pulse,
        userId,
        patientName: String(r.patientName).trim(),
        timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
      };
      const dup = await findDuplicate(doc);
      if (dup) { skipped.push(r); continue; }
      saved.push(await new Reading(doc).save());
    }
    res.status(201).json({ saved, skippedCount: skipped.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Route to save a new reading (Single, Protected, scoped to doctor)
app.post('/api/readings', auth, async (req, res) => {
  try {
    const userId = String(req.user.userId);
    const { systolic, diastolic, pulse, timestamp, patientName } = req.body;
    if (!patientName || !String(patientName).trim()) {
      return res.status(400).json({ error: 'Patient name is required' });
    }

    const doc = {
      systolic,
      diastolic,
      pulse,
      userId,
      patientName: String(patientName).trim(),
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    const dup = await findDuplicate(doc);
    if (dup) return res.status(200).json({ ...dup.toObject(), deduplicated: true });

    const savedReading = await new Reading(doc).save();
    res.status(201).json(savedReading);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Route to get all readings for the logged-in doctor (Protected)
app.get('/api/readings', auth, async (req, res) => {
  try {
    const readings = await Reading.find({ userId: String(req.user.userId) }).sort({ timestamp: -1 });
    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route to search readings by patient name, scoped to doctor (Protected)
// Exact (case-insensitive) match so history auto-loads without extra typing.
app.get('/api/readings/search', auth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'Patient name is required' });

    const readings = await Reading.find({
      userId: String(req.user.userId),
      patientName: { $regex: `^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).sort({ timestamp: -1 });

    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route to list all patients treated by the logged-in doctor (Protected)
app.get('/api/patients', auth, async (req, res) => {
  try {
    const userId = String(req.user.userId);
    const patients = await Reading.aggregate([
      { $match: { userId } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { $toLower: '$patientName' },
          name: { $first: '$patientName' },
          count: { $sum: 1 },
          lastTimestamp: { $first: '$timestamp' },
          lastSystolic: { $first: '$systolic' },
          lastDiastolic: { $first: '$diastolic' },
          lastPulse: { $first: '$pulse' },
        },
      },
      { $sort: { lastTimestamp: -1 } },
    ]);
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
