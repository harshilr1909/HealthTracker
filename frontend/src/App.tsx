import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Bluetooth, Activity, History, User, LogOut, Database, Heart, RefreshCw, Search } from 'lucide-react';

const API_URL = '/api';

// Custom ESP32 Service UUIDs
const ESP32_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const ESP32_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

interface Reading {
  _id?: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  timestamp: string;
  patientName?: string;
}

const App: React.FC = () => {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastReading, setLastReading] = useState<Reading | null>(null);
  const [syncBuffer, setSyncBuffer] = useState<Reading[]>([]);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [patientName, setPatientName] = useState<string>('');
  const patientNameRef = useRef(patientName);

  useEffect(() => {
    patientNameRef.current = patientName;
  }, [patientName]);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [showHistory, setShowHistory] = useState(!!localStorage.getItem('token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [activeDevice, setActiveDevice] = useState<any>(null);
  const [isConsoleStarted, setIsConsoleStarted] = useState(false);

  const addLog = (msg: string) => {
    if (!isConsoleStarted) return;
    setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 9)]);
  };

  // 1. Core connection logic (reusable)
  const connectToDevice = useCallback(async (device: any) => {
    try {
      addLog(`Connecting to ${device.name || 'Device'}...`);
      
      const server = await device.gatt?.connect();
      
      // Handle sudden disconnection
      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        addLog('Device lost! Reconnecting...');
        setTimeout(() => connectToDevice(device), 3000);
      });

      // Try Standard Blood Pressure Service first
      try {
        const service = await server.getPrimaryService(0x1810);
        const characteristic = await service.getCharacteristic(0x2A35);
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleBloodPressureMeasurement);
        addLog('Standard Monitor Linked.');
      } catch (e) {
        // Fallback to ESP32 Custom Service
        try {
          const service = await server.getPrimaryService(ESP32_SERVICE_UUID);
          const characteristic = await service.getCharacteristic(ESP32_CHAR_UUID);
          await characteristic.startNotifications();
          characteristic.addEventListener('characteristicvaluechanged', handleESP32Measurement);
          addLog('ESP32 Linked.');
        } catch (e2) {
          throw new Error('No compatible service found');
        }
      }

      setIsConnected(true);
      setActiveDevice(device);
    } catch (err: any) {
      addLog(`Link failed: ${err.message}`);
      setIsConnected(false);
    }
  }, []);

  // 2. Auto-connect on page load (if previously paired)
  useEffect(() => {
    const checkPairedDevices = async () => {
      if ('bluetooth' in navigator && (navigator.bluetooth as any).getDevices) {
        const devices = await (navigator.bluetooth as any).getDevices();
        if (devices.length > 0) {
          addLog("Found known device. Auto-connecting...");
          connectToDevice(devices[0]);
        }
      }
    };
    checkPairedDevices();
  }, [connectToDevice]);

  useEffect(() => {
    const interval = setInterval(() => {
        if (syncBuffer.length > 0) {
            bulkSaveBuffer(syncBuffer);
        }
    }, 5000);
    return () => clearInterval(interval);
  }, [syncBuffer, patientName]);

  const fetchReadings = async () => {
    if (!token) return;
    try {
      addLog('Fetching records...');
      const response = await axios.get(`${API_URL}/readings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReadings(response.data);
    } catch (err) {
      addLog('Session expired.');
      setToken(null);
      localStorage.removeItem('token');
    }
  };

  const fetchPatientReadings = async (name: string) => {
    if (!token || !name) return;
    try {
      addLog(`Searching for "${name}"...`);
      const response = await axios.get(`${API_URL}/readings/search?name=${name}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReadings(response.data);
      setShowHistory(true); // Always show list when searching
      if (response.data.length > 0) {
        addLog(`Found ${response.data.length} records for "${name}"`);
      } else {
        addLog(`No records found for "${name}"`);
      }
    } catch (err) {
      addLog('Search failed.');
    }
  };

  // Debounced search for records
  useEffect(() => {
    if (!token) return;
    const delayDebounceFn = setTimeout(() => {
      if (historySearch.trim()) {
        fetchPatientReadings(historySearch);
      } else {
        setReadings([]);
      }
    }, 600);

    return () => clearTimeout(delayDebounceFn);
  }, [historySearch, token]);

  const handleSearchAndScan = async () => {
    if (!patientName) {
      alert('Enter patient name first!');
      return;
    }
    
    // Start showing logs now
    setIsConsoleStarted(true);
    setDebugLog([`[${new Date().toLocaleTimeString()}] Initializing VitalHub Link...`]);

    // Set the history search to the patient name to show their specific history
    setHistorySearch(patientName);

    // Then start scanning (User gesture preserved if called from onClick/onKeyDown)
    if (!isConnected && !isScanning) {
      addLog('Auto-scanning for device...');
      startManualScan();
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const endpoint = isRegistering ? '/auth/register' : '/auth/login';
      const response = await axios.post(`${API_URL}${endpoint}`, { username, password });
      if (isRegistering) {
        setIsRegistering(false);
        alert('Done! Now login.');
      } else {
        const newToken = response.data.token;
        setToken(newToken);
        localStorage.setItem('token', newToken);
        addLog('Logged in.');
        setShowHistory(true); // Show history section on login
      }
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || 'Auth failed'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const effectiveLatestReading = lastReading || (readings.length > 0 ? readings[0] : null);

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('token');
    setShowHistory(false);
    setReadings([]);
    addLog('Logged out.');
  };

  const parseSFloat = (data: DataView, offset: number): number => {
    const b0 = data.getUint8(offset);
    const b1 = data.getUint8(offset + 1);
    const mantissa = ((b1 & 0x0F) << 8) | b0;
    const exponent = (b1 & 0xF0) >> 4;
    const signedMantissa = mantissa > 0x07FF ? mantissa - 0x1000 : mantissa;
    const signedExponent = exponent > 0x07 ? exponent - 0x10 : exponent;
    return signedMantissa * Math.pow(10, signedExponent);
  };

  const handleBloodPressureMeasurement = (event: any) => {
    try {
        const value = event.target.value;
        const flags = value.getUint8(0);
        let offset = 1;
        const systolic = Math.round(parseSFloat(value, offset));
        const diastolic = Math.round(parseSFloat(value, offset + 2));
        offset += 6;

        let timestamp = new Date().toISOString();
        if (flags & 0x02) {
            const year = value.getUint16(offset, true);
            const month = value.getUint8(offset + 2) - 1;
            const day = value.getUint8(offset + 3);
            const hours = value.getUint8(offset + 4);
            const minutes = value.getUint8(offset + 5);
            const seconds = value.getUint8(offset + 6);
            if (year >= 2020) timestamp = new Date(year, month, day, hours, minutes, seconds).toISOString();
            offset += 7;
        }

        let pulse = 0;
        if (flags & 0x04) {
            pulse = Math.round(parseSFloat(value, offset));
            offset += 2;
        }

        const newReading = { systolic, diastolic, pulse, timestamp, patientName: patientNameRef.current };
        setLastReading(newReading);
        setSyncBuffer(prev => [...prev, newReading]);
        addLog(`New measurement: ${systolic}/${diastolic}`);
    } catch (e) {
        addLog(`Parse error: ${e}`);
    }
  };

  const handleESP32Measurement = (event: any) => {
    try {
      const value = new TextDecoder().decode(event.target.value);
      // Expected format: "sys,dia,pulse" e.g. "120,80,72"
      const [systolic, diastolic, pulse] = value.split(',').map(Number);
      
      const newReading = { 
        systolic, 
        diastolic, 
        pulse, 
        timestamp: new Date().toISOString(), 
        patientName: patientNameRef.current 
      };
      setLastReading(newReading);
      setSyncBuffer(prev => [...prev, newReading]);
      addLog(`ESP32 Data: ${systolic}/${diastolic}`);
    } catch (e) {
      addLog('ESP32 Parse Error');
    }
  };

  const bulkSaveBuffer = async (buffer: Reading[]) => {
    try {
      await axios.post(`${API_URL}/readings/bulk`, buffer);
      addLog('Synced to server.');
      setSyncBuffer([]);
      // Refresh the current view
      if (patientName) {
        fetchPatientReadings(patientName);
      } else {
        fetchReadings();
      }
    } catch (err) {
      addLog('Retrying sync...');
    }
  };

  const startManualScan = async () => {
    if (!patientName) {
      alert('Enter patient name first!');
      return;
    }
    setIsScanning(true);
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { services: [0x1810] },
          { namePrefix: 'VitalHub' }
        ],
        optionalServices: [0x1810, ESP32_SERVICE_UUID]
      });
      await connectToDevice(device);
    } catch (err: any) {
      addLog(`Scan cancelled.`);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="app-container">
      <header className="main-header">
        <h1><Activity size={28} style={{verticalAlign: 'middle', marginRight: '8px'}} /> VitalHub Hospital System</h1>
        <div className="auth-section">
          {!token ? (
            <form onSubmit={handleAuth} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="text" placeholder="User" value={username} onChange={(e) => setUsername(e.target.value)} required style={{marginBottom: 0, width: '100px'}} />
              <input type="password" placeholder="Pass" value={password} onChange={(e) => setPassword(e.target.value)} required style={{marginBottom: 0, width: '100px'}} />
              <button type="submit" disabled={isLoggingIn}>
                {isLoggingIn ? '...' : isRegistering ? 'Sign Up' : 'Login'}
              </button>
              <button type="button" onClick={() => setIsRegistering(!isRegistering)} style={{background: 'none', color: 'var(--primary)', padding: '0', fontSize: '11px', border: 'none'}}>
                {isRegistering ? 'Login Instead' : 'Register'}
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{fontWeight: 600, color: 'var(--text-muted)', fontSize: '14px'}}><User size={14} /> {username || 'User'}</span>
              <button onClick={handleLogout} style={{background: 'var(--bg-gray)', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '4px 10px', fontSize: '12px'}}>
                <LogOut size={14} /> Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="history-grid">
        <aside>
          <div className="card">
            <h3><Bluetooth size={20} /> Device Setup</h3>
            <div style={{ marginBottom: '15px', fontSize: '14px' }}>
              <p style={{ margin: '5px 0' }}>
                <strong>Status:</strong> {isConnected ? <span style={{color: 'green'}}>● Connected</span> : <span style={{color: 'red'}}>○ Disconnected</span>}
              </p>
              {activeDevice && isConnected && (
                <p style={{ margin: '5px 0', fontSize: '11px', opacity: 0.7 }}>ID: {activeDevice.id.slice(0, 10)}...</p>
              )}
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="text" 
                placeholder="Active Patient Name" 
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSearchAndScan()}
              />
              <button onClick={handleSearchAndScan} disabled={isScanning || isConnected} style={{width: '100%'}}>
                {isScanning ? <RefreshCw className="animate-spin" size={16} /> : <Bluetooth size={16} />}
                {isScanning ? 'Scanning...' : isConnected ? 'Device Linked' : 'Connect & Scan'}
              </button>
              {isConnected && (
                <p style={{fontSize: '11px', textAlign: 'center', color: 'var(--text-muted)'}}>
                  Auto-reconnect is active.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <h3><Database size={20} /> System Console</h3>
            <div className="log-container">
              {debugLog.map((log, i) => <div key={i} style={{marginBottom: '4px'}}>{log}</div>)}
              {debugLog.length === 0 && <div style={{opacity: 0.5}}>Waiting for activity...</div>}
            </div>
          </div>
        </aside>

        <main>
          <div className="card">
            <h3><Activity size={20} /> Latest Result</h3>
            {effectiveLatestReading ? (
              <div className="reading-display">
                <span className="reading-meta">SYS / DIA (mmHg)</span>
                <div className="reading-value">
                  {effectiveLatestReading.systolic}/{effectiveLatestReading.diastolic}
                </div>
                <div style={{marginTop: '15px'}}>
                  <span className="pulse-badge"><Heart size={18} fill="currentColor" /> {effectiveLatestReading.pulse} BPM</span>
                </div>
                <p className="reading-meta" style={{marginTop: '20px'}}>
                  Patient: <strong>{effectiveLatestReading.patientName || 'Unknown'}</strong><br/>
                  Captured: {new Date(effectiveLatestReading.timestamp).toLocaleString()}
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                <Activity size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                <p>Waiting for data...</p>
              </div>
            )}
          </div>

          {showHistory && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{margin: 0}}>
                  <History size={20} /> Patient History
                </h3>
              </div>

              <div style={{ position: 'relative', marginBottom: '15px' }}>
                <input 
                  type="text" 
                  placeholder="Search Patient Name..." 
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)} 
                  style={{ paddingRight: '35px', marginBottom: 0 }}
                />
                <div style={{ position: 'absolute', right: '10px', top: '10px', opacity: 0.5 }}>
                  <Search size={16} />
                </div>
              </div>
              
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {historySearch.trim() ? (
                  readings.length > 0 ? (
                    readings.map((r) => (
                      <div key={r._id} className="reading-item">
                        <div>
                          <div style={{fontWeight: 700}}>{r.systolic}/{r.diastolic} <small>mmHg</small></div>
                          <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>{r.patientName || 'Unknown'} • {new Date(r.timestamp).toLocaleDateString()}</div>
                        </div>
                        <div style={{color: 'var(--accent)', fontWeight: 600, fontSize: '14px'}}>
                          {r.pulse} <small>BPM</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{textAlign: 'center', color: 'var(--text-muted)'}}>No records found for "{historySearch}".</p>
                  )
                ) : (
                  <p style={{textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)'}}>Type a name above to view history.</p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
