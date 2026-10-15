# Beurer BM54 Blood Pressure Tracker

A full-stack web application designed to capture real-time blood pressure and pulse data from a **Beurer BM54** (Bluetooth LE) monitor and store it in a **MongoDB** database.

## 🚀 Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide React (Icons)
- **Backend:** Node.js, Express.js
- **Database:** MongoDB (via Mongoose)
- **Communication:** Web Bluetooth API (GATT Profile)

## 📋 Prerequisites

- **Browser:** Google Chrome, Edge, or any browser supporting the [Web Bluetooth API](https://caniuse.com/web-bluetooth).
- **Hardware:** Beurer BM54 Blood Pressure Monitor.
- **Node.js:** v16.0.0 or higher.
- **MongoDB:** A local instance or MongoDB Atlas URI.

## 🛠️ Installation & Setup

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd mark1
```

### 2. Run Everything (one command, from the repo root)
```bash
./start.sh
# or: npm run dev  (same thing — calls start.sh)
# or: npm start
```
This starts the backend (`http://localhost:5000`) and the frontend
(`http://localhost:5173`) together. Press `Ctrl+C` to stop both.
Dependencies are auto-installed on first run; or install upfront with
`npm run install:all`.

### 3. Backend Setup (manual alternative)
```bash
cd backend
npm install
```
Create a `.env` file in the `backend` directory:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/beurer_data
```
Start the backend server:
```bash
npm start # or 'npx nodemon server.js' for development
```

### 3. Frontend Setup (manual alternative)
```bash
cd ../frontend
npm install
npm run dev
```
The application will be available at `http://localhost:5173`.

## 🩸 How it Works

1. **Bluetooth Pairing:** The BM54 uses the standard **Bluetooth SIG Blood Pressure Profile (0x1810)**.
2. **Data Capture:** When you click "Capture Reading" in the app, it searches for the device and connects to the **Blood Pressure Measurement Characteristic (0x2A35)**.
3. **Measurement:** 
   - Ensure the BM54 is in Bluetooth mode (usually by completing a measurement or pressing the M1/M2 memory buttons).
   - Once connected, the app listens for **Indications**.
4. **Processing:** The app parses the byte array (IEEE-11073 16-bit SFLOAT) to extract Systolic, Diastolic, and Pulse values.
5. **Storage:** The parsed data is sent via a POST request to the Express API, which persists it in MongoDB.

## 📐 Data Schema (MongoDB)

```json
{
  "systolic": Number,
  "diastolic": Number,
  "pulse": Number,
  "timestamp": Date,
  "userId": String
}
```

## ⚠️ Troubleshooting

- **Device not found?** Ensure Bluetooth is enabled on your PC and the BM54 is close by. The BM54 Bluetooth icon should be flashing or active.
- **CORS Errors?** The backend is configured to allow requests from `http://localhost:5173`. If you change the frontend port, update the `cors()` config in `server.js`.
- **SFLOAT Parsing:** Different devices might use different flag configurations. This implementation follows the standard Bluetooth SIG specification for blood pressure measurements.

## 📄 License
MIT
