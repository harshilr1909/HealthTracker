require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Reading = require('./models/Reading');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/beurer_data';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ESP32_API_KEY = process.env.ESP32_API_KEY || 'esp32-secret-123';

app.use(cors());
app.use(express.json());

// ESP32 Direct WiFi Endpoint
app.post('/api/esp32/reading', async (req, res) => {
  try {
    const apiKey = req.header('X-API-Key');
    if (apiKey !== ESP32_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const { systolic, diastolic, pulse, patientName } = req.body;
    const newReading = new Reading({
      systolic, diastolic, pulse,
      patientName: patientName || 'ESP32_User',
      timestamp: new Date(),
      userId: 'esp32_device'
    });
    await newReading.save();
    res.status(201).json({ message: 'Success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Register Route
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`Attempting to register user: ${username}`);
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });
    
    const user = new User({ username, password });
    await user.save();
    console.log('User saved successfully');
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route to save multiple readings (Bulk)
app.post('/api/readings/bulk', async (req, res) => {
  try {
    const readings = req.body;
    if (!Array.isArray(readings)) {
      return res.status(400).json({ error: 'Expected an array of readings' });
    }
    
    const formattedReadings = readings.map(r => ({
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      userId: r.userId || 'user1',
      patientName: r.patientName,
      timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
    }));

    const savedReadings = await Reading.insertMany(formattedReadings);
    res.status(201).json(savedReadings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Route to save a new reading (Single)
app.post('/api/readings', async (req, res) => {
  try {
    const { systolic, diastolic, pulse, userId, timestamp, patientName } = req.body;
    if (!patientName) return res.status(400).json({ error: 'Patient name is required' });
    
    const newReading = new Reading({
      systolic,
      diastolic,
      pulse,
      userId: userId || 'user1',
      patientName,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });
    const savedReading = await newReading.save();
    res.status(201).json(savedReading);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Route to get all readings (Protected)
app.get('/api/readings', auth, async (req, res) => {
  try {
    const readings = await Reading.find().sort({ timestamp: -1 });
    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route to search readings by patient name (Protected)
app.get('/api/readings/search', auth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'Patient name is required' });
    
    const readings = await Reading.find({ 
      patientName: { $regex: name, $options: 'i' } 
    }).sort({ timestamp: -1 });
    
    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
