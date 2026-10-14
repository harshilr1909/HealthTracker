import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Bluetooth, Activity, History, LogOut, Database, Heart, RefreshCw, Search, Users, ChevronDown } from 'lucide-react';

const API_URL = '/api';
// How long to wait after the last BLE packet before deciding the
// memory-dump burst is over and picking the latest reading.
const BURST_WINDOW_MS = 2500;

interface Reading {
  _id?: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  timestamp: string;
  patientName?: string;
  deduplicated?: boolean;
}

interface Patient {
  _id: string;
  name: string;
  count: number;
  lastTimestamp: string;
  lastSystolic: number;
  lastDiastolic: number;
  lastPulse: number;
}

// Single-line doctor label: name once, ID only when it differs.
// Strips a stored "Dr." prefix so we never render "Dr. Dr. X",
// and hides the ID when it duplicates the name (e.g. "Harshil • Harshil").
function formatDoctorLabel(doctor: { name: string; hospitalId: string }): string {
  const cleanName = (doctor.name || '').replace(/^\s*dr\.?\s+/i, '').trim() || doctor.hospitalId || 'Doctor';
  const id = (doctor.hospitalId || '').trim();
  const dup = id && (id.toLowerCase() === cleanName.toLowerCase() || id.toLowerCase() === (doctor.name || '').trim().toLowerCase());
  return dup || !id ? cleanName : `${cleanName} • ${id}`;
}

const App: React.FC = () => {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastReading, setLastReading] = useState<Reading | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [patientName, setPatientName] = useState<string>('');
  const [activePatient, setActivePatient] = useState<string>('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientFilter, setPatientFilter] = useState<string>('');
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [showHistory, setShowHistory] = useState(!!localStorage.getItem('token'));
  const [hospitalId, setHospitalId] = useState('');
  const [regName, setRegName] = useState('');
  const [password, setPassword] = useState('');
  const [doctor, setDoctor] = useState<{ name: string; hospitalId: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('doctor') || 'null'); } catch { return null; }
  });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authModal, setAuthModal] = useState<null | 'login' | 'register'>(null);
  const [activeDevice, setActiveDevice] = useState<any>(null);
  const [isConsoleStarted, setIsConsoleStarted] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [burstCount, setBurstCount] = useState(0);

  // Refs so BLE callbacks / timers never see stale state
  const activePatientRef = useRef(activePatient);
  const tokenRef = useRef(token);
  const burstRef = useRef<Reading[]>([]);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { activePatientRef.current = activePatient; }, [activePatient]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const addLog = (msg: string) => {
    if (!isConsoleStarted) return;
    setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 9)]);
  };

  const authHeaders = useCallback(() => ({
    headers: { Authorization: `Bearer ${tokenRef.current}` }
  }), []);

  // ---- Data fetching (all scoped to logged-in doctor by the backend) ----

  const fetchPatientHistory = useCallback(async (name: string) => {
    if (!tokenRef.current || !name.trim()) return;
    try {
      const response = await axios.get(
        `${API_URL}/readings/search?name=${encodeURIComponent(name.trim())}`,
        authHeaders()
      );
      setReadings(response.data);
    } catch {
      addLog('History load failed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  const fetchPatients = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const response = await axios.get(`${API_URL}/patients`, authHeaders());
      setPatients(response.data);
    } catch {
      addLog('Patient list load failed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  // Auto-display history whenever the active patient changes — no typing needed.
  useEffect(() => {
    if (token && activePatient.trim()) {
      fetchPatientHistory(activePatient);
    }
  }, [activePatient, token, fetchPatientHistory]);

  const fetchDoctor = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const response = await axios.get(`${API_URL}/auth/me`, authHeaders());
      setDoctor(response.data);
      localStorage.setItem('doctor', JSON.stringify(response.data));
    } catch {
      addLog('Doctor profile load failed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  // Load patient list + doctor profile on login.
  useEffect(() => {
    if (token) {
      fetchPatients();
      if (!doctor) fetchDoctor();
    }
    else { setPatients([]); setReadings([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, fetchPatients]);

  // ---- Latest-only auto-save ----

  const saveLatestReading = useCallback(async (latest: Reading) => {
    const name = (latest.patientName || activePatientRef.current || '').trim();
    if (!name) {
      addLog('No active patient — reading discarded.');
      setIsCollecting(false);
      setBurstCount(0);
      return;
    }
    if (!tokenRef.current) {
      addLog('Not logged in — reading kept locally only.');
      setLastReading({ ...latest, patientName: name });
      setIsCollecting(false);
      setBurstCount(0);
      return;
    }
    setIsSaving(true);
    try {
      const response = await axios.post(
        `${API_URL}/readings`,
        { ...latest, patientName: name },
        authHeaders()
      );
      const saved: Reading = response.data;
      setLastReading(saved);
      if ((saved as Reading).deduplicated) {
        addLog(`Duplicate ignored: ${saved.systolic}/${saved.diastolic} for "${name}".`);
      } else {
        addLog(`Saved latest: ${saved.systolic}/${saved.diastolic} for "${name}".`);
      }
      // Refresh auto-history + patient list without asking for the name.
      await fetchPatientHistory(name);
      await fetchPatients();
    } catch {
      addLog('Save failed — will retry on next burst.');
    } finally {
      setIsSaving(false);
      setIsCollecting(false);
      setBurstCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders, fetchPatientHistory, fetchPatients]);

  const flushBurst = useCallback(() => {
    const burst = burstRef.current;
    burstRef.current = [];
    if (burstTimerRef.current) { clearTimeout(burstTimerRef.current); burstTimerRef.current = null; }
    if (burst.length === 0) return;
    // Pick latest by device timestamp (not arrival order).
    const latest = burst.reduce((a, b) =>
      new Date(b.timestamp).getTime() > new Date(a.timestamp).getTime() ? b : a
    );
    addLog(`Burst done: ${burst.length} packet(s), latest ${latest.systolic}/${latest.diastolic}. Saving…`);
    saveLatestReading(latest);
  }, [saveLatestReading]);

  const queueBurstReading = useCallback((reading: Reading) => {
    burstRef.current.push(reading);
    // Intentionally do NOT update lastReading here — intermediates stay hidden.
    // Only the final latest (chosen in flushBurst) is ever displayed/saved.
    setIsCollecting(true);
    setBurstCount(burstRef.current.length);
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(flushBurst, BURST_WINDOW_MS);
  }, [flushBurst]);

  // ---- BLE handling ----

  const parseSFloat = (data: DataView, offset: number): number => {
    const b0 = data.getUint8(offset);
    const b1 = data.getUint8(offset + 1);
    const mantissa = ((b1 & 0x0F) << 8) | b0;
    const exponent = (b1 & 0xF0) >> 4;
    const signedMantissa = mantissa > 0x07FF ? mantissa - 0x1000 : mantissa;
    const signedExponent = exponent > 0x07 ? exponent - 0x10 : exponent;
    return signedMantissa * Math.pow(10, signedExponent);
  };

  const handleBloodPressureMeasurement = useCallback((event: any) => {
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
      }

      const name = (activePatientRef.current || '').trim();
      queueBurstReading({ systolic, diastolic, pulse, timestamp, patientName: name || 'Unknown' });
      addLog(`Packet: ${systolic}/${diastolic} @ ${new Date(timestamp).toLocaleTimeString()}`);
    } catch (e) {
      addLog(`Parse error: ${e}`);
    }
  }, [queueBurstReading]);

  const connectToDevice = useCallback(async (device: any) => {
    try {
      addLog(`Connecting to ${device.name || 'Device'}...`);
      const server = await device.gatt?.connect();
      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        addLog('Device lost! Reconnecting...');
        setTimeout(() => connectToDevice(device), 3000);
      });
      const service = await server.getPrimaryService(0x1810);
      const characteristic = await service.getCharacteristic(0x2A35);
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleBloodPressureMeasurement);
      addLog('Monitor linked. Take a measurement — latest will auto-save.');
      setIsConnected(true);
      setActiveDevice(device);
    } catch (err: any) {
      addLog(`Link failed: ${err.message}`);
      setIsConnected(false);
    }
  }, [handleBloodPressureMeasurement]);

  useEffect(() => {
    const checkPairedDevices = async () => {
      if ('bluetooth' in navigator && (navigator.bluetooth as any).getDevices) {
        const devices = await (navigator.bluetooth as any).getDevices();
        if (devices.length > 0) {
          addLog('Found known device. Auto-connecting...');
          connectToDevice(devices[0]);
        }
      }
    };
    checkPairedDevices();
  }, [connectToDevice]);

  // Cleanup burst timer on unmount
  useEffect(() => {
    return () => { if (burstTimerRef.current) clearTimeout(burstTimerRef.current); };
  }, []);

  const handleSearchAndScan = async () => {
    if (!patientName.trim()) {
      alert('Enter patient name first!');
      return;
    }
    setIsConsoleStarted(true);
    setDebugLog([`[${new Date().toLocaleTimeString()}] Initializing VitalHub Link...`]);
    // Commit the active patient once — history auto-loads from here on.
    setActivePatient(patientName.trim());
    if (!isConnected && !isScanning) {
      addLog('Auto-scanning for device...');
      startManualScan();
    }
  };

  const handleSelectPatient = (name: string) => {
    setPatientName(name);
    setActivePatient(name);
    addLog(`Viewing "${name}"…`);
  };

  const closeAuthModal = () => {
    if (!isLoggingIn) setAuthModal(null);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const mode = authModal || 'login';
    setIsLoggingIn(true);
    try {
      if (mode === 'register') {
        if (!regName.trim() || !hospitalId.trim() || !password) {
          alert('Please enter your name, Hospital ID and password.');
          return;
        }
        await axios.post(`${API_URL}/auth/register`, {
          name: regName.trim(),
          hospitalId: hospitalId.trim(),
          password,
        });
        setAuthModal('login');
        setRegName('');
        setPassword('');
        alert('Registered! Now log in with your Hospital ID.');
      } else {
        if (!hospitalId.trim() || !password) {
          alert('Please enter your Hospital ID and password.');
          return;
        }
        const response = await axios.post(`${API_URL}/auth/login`, {
          hospitalId: hospitalId.trim(),
          password,
        });
        const newToken = response.data.token;
        setToken(newToken);
        localStorage.setItem('token', newToken);
        if (response.data.doctor) {
          setDoctor(response.data.doctor);
          localStorage.setItem('doctor', JSON.stringify(response.data.doctor));
        } else {
          fetchDoctor();
        }
        setPassword('');
        setShowHistory(true);
        setAuthModal(null);
      }
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || 'Auth failed'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Close modal on Escape
  useEffect(() => {
    if (!authModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAuthModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authModal]);

  const effectiveLatestReading = lastReading || (readings.length > 0 ? readings[0] : null);

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('token');
    setDoctor(null);
    localStorage.removeItem('doctor');
    setHospitalId('');
    setRegName('');
    setPassword('');
    setShowHistory(false);
    setReadings([]);
    setPatients([]);
    setActivePatient('');
    addLog('Signed out.');
  };

  const startManualScan = async () => {
    if (!patientName.trim()) {
      alert('Enter patient name first!');
      return;
    }
    setIsScanning(true);
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: [0x1810] }],
        optionalServices: [0x1810]
      });
      await connectToDevice(device);
    } catch {
      addLog('Scan cancelled.');
    } finally {
      setIsScanning(false);
    }
  };

  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(patientFilter.trim().toLowerCase())
  );

  return (
    <div className="app-container">
      <header className="main-header">
        <h1><Activity size={28} style={{verticalAlign: 'middle', marginRight: '8px'}} /> VitalHub Hospital System</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="auth-section">
          {!token ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => setAuthModal('login')}>
                Login
              </button>
              <button
                type="button"
                onClick={() => setAuthModal('register')}
                style={{ background: 'var(--bg-gray)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
              >
                Sign up
              </button>
            </div>
          ) : (
            <div className="signed-in-card">
              <span className="signed-in-dot" />
              <div className="signed-in-text">
                <strong>Signed in</strong>
                <span>{doctor ? formatDoctorLabel(doctor) : 'Doctor'}</span>
              </div>
              <button onClick={handleLogout} className="signout-btn">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
          </div>
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
              {isConnected && activePatient && (
                <p style={{fontSize: '11px', textAlign: 'center', color: 'var(--text-muted)'}}>
                  Recording as <strong>{activePatient}</strong> — latest auto-saves{isSaving ? ' (saving…)' : '.'}
                </p>
              )}
            </div>
          </div>

          {token && (
            <div className="card">
              <h3><Users size={20} /> My Patients {patients.length > 0 && <span style={{fontSize: '12px', color: 'var(--text-muted)'}}>({patients.length})</span>}</h3>
              <div style={{ position: 'relative', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Filter patients..."
                  value={patientFilter}
                  onChange={(e) => setPatientFilter(e.target.value)}
                  style={{ paddingRight: '35px', marginBottom: 0 }}
                />
                <div style={{ position: 'absolute', right: '10px', top: '10px', opacity: 0.5 }}>
                  <Search size={16} />
                </div>
              </div>
              <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                {filteredPatients.length > 0 ? (
                  filteredPatients.map((p) => (
                    <button
                      key={p._id}
                      onClick={() => handleSelectPatient(p.name)}
                      className={`patient-item${activePatient.toLowerCase() === p.name.toLowerCase() ? ' active' : ''}`}
                    >
                      <span className="patient-name">{p.name}</span>
                      <span className="patient-meta">
                        {p.count} reading{p.count === 1 ? '' : 's'} • {new Date(p.lastTimestamp).toLocaleDateString()}
                      </span>
                    </button>
                  ))
                ) : (
                  <p style={{textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)'}}>
                    {patients.length === 0 ? 'No patients yet. Connect a monitor to record the first one.' : 'No match.'}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="card console-card">
            <button className="console-toggle" onClick={() => setConsoleOpen(o => !o)} aria-expanded={consoleOpen}>
              <span className="console-toggle-left"><Database size={20} /> System Console</span>
              <ChevronDown size={18} className={`console-chevron${consoleOpen ? ' open' : ''}`} />
            </button>
            {consoleOpen && (
              <div className="log-container">
                {debugLog.map((log, i) => <div key={i} style={{marginBottom: '4px'}}>{log}</div>)}
                {debugLog.length === 0 && <div style={{opacity: 0.5}}>Waiting for activity...</div>}
              </div>
            )}
            {!consoleOpen && (
              <p className="console-hint">Hidden — click above to expand logs.</p>
            )}
          </div>
        </aside>

        <main>
          <div className="card">
            <h3><Activity size={20} /> Latest Result</h3>
            {(isCollecting || isSaving) ? (
              <div className="reading-display analyzing">
                <div className="analyzing-spinner"><RefreshCw size={40} className="animate-spin" /></div>
                <div className="analyzing-title">
                  {isSaving ? 'Saving final result…' : 'Analyzing memory…'}
                </div>
                <div className="analyzing-sub">
                  {burstCount > 0
                    ? `${burstCount} packet${burstCount === 1 ? '' : 's'} received — holding display until latest is confirmed.`
                    : 'Waiting for device packets…'}
                </div>
                <div className="analyzing-dots"><span /><span /><span /></div>
                {effectiveLatestReading && (
                  <div className="previous-final">
                    Previous final: <strong>{effectiveLatestReading.systolic}/{effectiveLatestReading.diastolic}</strong>
                    {' '}• {effectiveLatestReading.pulse} BPM • {effectiveLatestReading.patientName || 'Unknown'}
                  </div>
                )}
              </div>
            ) : effectiveLatestReading ? (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{margin: 0}}>
                  <History size={20} /> Patient History
                  {activePatient && <span style={{fontSize: '13px', color: 'var(--text-muted)'}}> — {activePatient}</span>}
                </h3>
                {activePatient && (
                  <button
                    onClick={() => fetchPatientHistory(activePatient)}
                    style={{background: 'var(--bg-gray)', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '4px 10px', fontSize: '12px'}}
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                )}
              </div>

              {!activePatient ? (
                <p style={{textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)'}}>
                  Enter a patient name and press Connect &amp; Scan, or click a patient on the left.
                </p>
              ) : (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {readings.length > 0 ? (
                    readings.map((r) => (
                      <div key={r._id} className="reading-item">
                        <div>
                          <div style={{fontWeight: 700}}>{r.systolic}/{r.diastolic} <small>mmHg</small></div>
                          <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>{r.patientName || 'Unknown'} • {new Date(r.timestamp).toLocaleString()}</div>
                        </div>
                        <div style={{color: 'var(--accent)', fontWeight: 600, fontSize: '14px'}}>
                          {r.pulse} <small>BPM</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{textAlign: 'center', color: 'var(--text-muted)'}}>No records yet for "{activePatient}". Take a measurement to create the first one.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {authModal && (
        <div className="auth-overlay" onClick={closeAuthModal}>
          <div className="auth-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="auth-close" onClick={closeAuthModal} aria-label="Close">✕</button>
            <h2>{authModal === 'login' ? 'Doctor Login' : 'Doctor Sign up'}</h2>
            <p className="auth-sub">
              {authModal === 'login'
                ? 'Enter your Hospital ID and password.'
                : 'New doctors register with name, Hospital ID and password.'}
            </p>
            <form onSubmit={handleAuth}>
              {authModal === 'register' && (
                <label>
                  Full name
                  <input type="text" placeholder="e.g. Harshil Shah" value={regName} onChange={(e) => setRegName(e.target.value)} required />
                </label>
              )}
              <label>
                Hospital ID
                <input type="text" placeholder="e.g. HOSP123" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} required />
              </label>
              <label>
                Password
                <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <button type="submit" disabled={isLoggingIn} className="auth-submit">
                {isLoggingIn ? 'Please wait…' : authModal === 'login' ? 'Login' : 'Sign up'}
              </button>
            </form>
            <button
              type="button"
              className="auth-switch"
              onClick={() => setAuthModal(authModal === 'login' ? 'register' : 'login')}
            >
              {authModal === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
