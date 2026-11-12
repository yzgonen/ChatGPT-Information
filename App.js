import React, { useCallback, useEffect, useMemo, useState } from 'react';

const NAV_ITEMS = [
  { id: 'home', label: 'Dashboard', icon: 'grid' },
  { id: 'latency', label: 'Latency', icon: 'bolt' },
  { id: 'network', label: 'Network', icon: 'globe' },
  { id: 'services', label: 'Services & Debloat', icon: 'shield' },
  { id: 'games', label: 'Games & Apps', icon: 'gamepad' },
  { id: 'storage', label: 'Storage Cleanup', icon: 'disk' },
  { id: 'logs', label: 'Activity Logs', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'sliders' }
];

const SUBTABS = {
  latency: ['Scheduling', 'Keyboard & Mouse', 'Power Plan', 'Controller'],
  network: ['Routing & Ping', 'Packet Loss', 'Epic Downloads', 'Windows Tweaks'],
  services: ['Telemetry & Diagnostics', 'Windows Bloatware'],
  games: ['Fortnite Settings', 'Audio & Repair', 'Memory']
};

const REGION_OPTIONS = [
  { id: 'eu-central', label: 'Europe · Frankfurt', gameTargets: 'Fortnite EU / Minecraft Frankfurt', probeHost: 'AWS eu-central-1' },
  { id: 'eu-west', label: 'Europe · Ireland', gameTargets: 'European regional comparison', probeHost: 'AWS eu-west-1' },
  { id: 'na-east', label: 'North America · East', gameTargets: 'Fortnite NA-East', probeHost: 'AWS us-east-1' },
  { id: 'na-central', label: 'North America · Central', gameTargets: 'Fortnite NA-Central', probeHost: 'AWS us-east-2' },
  { id: 'na-west', label: 'North America · West', gameTargets: 'Fortnite NA-West', probeHost: 'AWS us-west-2' },
  { id: 'brazil', label: 'Brazil · São Paulo', gameTargets: 'Fortnite Brazil / South America', probeHost: 'AWS sa-east-1' },
  { id: 'asia', label: 'Asia · Tokyo', gameTargets: 'Fortnite Asia / regional comparison', probeHost: 'AWS ap-northeast-1' },
  { id: 'oceania', label: 'Oceania · Sydney', gameTargets: 'Fortnite Oceania', probeHost: 'AWS ap-southeast-2' },
  { id: 'middle-east', label: 'Middle East · Bahrain', gameTargets: 'Fortnite Middle East', probeHost: 'AWS me-south-1' },
  { id: 'south-africa', label: 'Africa · Cape Town', gameTargets: 'Minecraft or other server only; Fortnite may not offer Africa', probeHost: 'AWS af-south-1' }
];

const MEMORY_TARGET_DEFAULTS = { chrome: 25, msedge: 25, discord: 20, epicgameslauncher: 15, epicwebhelper: 15, steam: 15, spotify: 10 };

function readSavedState(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch { return fallback; }
}

function useSavedState(key, fallback) {
  const [value, setValue] = useState(() => readSavedState(key, fallback));
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences stay usable if storage is unavailable. */ }
  }, [key, value]);
  return [value, setValue];
}

const PROFILE_OPTIONS = [
  { id: 'lobbyAnimations', title: 'Lobby Stream Optimization', setting: 'bShowLobbyBackground', description: 'Reduce the lobby background animation where the current game build honors this setting.', caution: 'Game updates can ignore or rewrite this value.' },
  { id: 'mobileRenderPathway', title: 'Mobile Rendering Path', setting: 'D3DRHIPreference', description: 'Request the ES31 rendering path. Fortnite may ignore unsupported values.' },
  { id: 'grassRemoval', title: 'Grass Removal', setting: 'bShowGrass', description: 'Request reduced grass rendering where supported by this game build.' },
  { id: 'foliageMotion', title: 'Foliage Quality Override', setting: 'sg.FoliageQuality', description: 'Set foliage quality to zero in the scalability profile.' },
  { id: 'mouseAcceleration', title: 'Disable Mouse Acceleration', setting: 'bDisableMouseAcceleration', description: 'Write the selected mouse setting when supported by Fortnite.' }
];

const NETWORK_OPTIONS = [
  { id: 'tcpNoDelay', title: 'TCPNoDelay', value: 'TCPNoDelay = 1', description: 'Affects eligible TCP traffic; Fortnite gameplay commonly uses UDP, so this is not a promised ping fix.' },
  { id: 'tcpAckFrequency', title: 'TCPAckFrequency', value: 'TCPAckFrequency = 1', description: 'Changes TCP acknowledgements for the active adapter, not the game server route.' },
  { id: 'disableThrottling', title: 'Windows Network Throttling', value: 'NetworkThrottlingIndex = ffffffff', description: 'Windows multimedia network policy. Results vary by workload.' },
  { id: 'flushDns', title: 'Flush DNS Cache', value: 'ipconfig /flushdns', description: 'Clears cached name lookups; it does not reduce in-match ping by itself.' },
  { id: 'cloudflareDns', title: 'Cloudflare DNS', value: '1.1.1.1 / 1.0.0.1', description: 'Changes DNS for the active adapter and can affect every app on this PC.' },
  { id: 'tcpAutoTuning', title: 'TCP Auto-Tuning + ECN', value: 'normal · enabled', description: 'Windows TCP behavior; it is not a direct Fortnite UDP latency switch.' }
];

const SERVICES = [
  ['DiagTrack', 'Connected User Experiences and Telemetry', 'Telemetry service; review before changing.'],
  ['WerSvc', 'Windows Error Reporting', 'Collects crash reports; disabling can reduce diagnostic data.'],
  ['SysMain', 'SysMain / prefetching', 'Windows manages this automatically; test only if disk pressure is measured.'],
  ['wuauserv', 'Windows Update', 'Keep enabled so security and driver updates can install.'],
  ['WbioSrvc', 'Windows Biometric Service', 'Needed for fingerprint and biometric sign-in.']
];

const INITIAL_METRICS = { cpu: null, gpu: null, memoryUsed: null, memoryTotal: null, latency: null, packetLoss: null, adapter: 'No test run' };

function parseResult(value) {
  if (typeof value !== 'string') return value || {};
  try { return JSON.parse(value); } catch { return { message: value }; }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function Icon({ name, size = 20, className = '' }) {
  const icons = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    gamepad: <><path d="M6.2 9.2h11.6a4.1 4.1 0 0 1 4 4.9l-.5 2.7a2.7 2.7 0 0 1-4.5 1.5l-2-1.8H9.2l-2 1.8a2.7 2.7 0 0 1-4.5-1.5l-.5-2.7a4.1 4.1 0 0 1 4-4.9Z" /><path d="M7 11.8v4M5 13.8h4M16.5 13h.01M19 15.5h.01" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" /></>,
    sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
    memory: <><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M19 10v4M6 17v3M10 17v3M14 17v3M18 17v3" /></>,
    signal: <><path d="M3 20h2v-3H3zM8 20h2v-7H8zM13 20h2V9h-2zM18 20h2V4h-2z" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    warning: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 16h.01" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.7 9A8 8 0 0 1 19 6l1 1M4 17v-5h5" /><path d="M19.3 15A8 8 0 0 1 5 18l-1-1" /></>,
    disk: <><path d="M4 4h13l3 3v13H4z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    sound: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" /></>,
    controller: <><path d="M6 9h12a4 4 0 0 1 3.8 5.3l-.7 2.4a2 2 0 0 1-3.2 1l-2.2-1.8H8.3l-2.2 1.8a2 2 0 0 1-3.2-1l-.7-2.4A4 4 0 0 1 6 9Z" /><path d="M7 11v4M5 13h4M16 12h.01M18.5 14.5h.01" /></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{icons[name] || icons.grid}</svg>;
}

function Pill({ children, tone = 'neutral' }) {
  const colors = { neutral: 'border-white/10 bg-white/[0.04] text-[#aaa]', green: 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300', amber: 'border-amber-400/15 bg-amber-400/[0.07] text-amber-200', red: 'border-rose-400/15 bg-rose-400/[0.07] text-rose-200' };
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide ${colors[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === 'green' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-300' : tone === 'red' ? 'bg-rose-300' : 'bg-[#777]'}`} />{children}</span>;
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className={`relative h-8 w-[56px] shrink-0 rounded-full border transition-colors duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'border-white bg-white' : 'border-white/10 bg-[#202020]'}`}><span className={`absolute left-[3px] top-[3px] h-6 w-6 rounded-full transition-transform duration-200 ease-out ${checked ? 'translate-x-6 bg-black' : 'translate-x-0 bg-[#858585]'}`} /></button>;
}

function Card({ children, className = '' }) {
  return <section className={`rounded-2xl border border-white/5 bg-[#0d0d0d] p-6 ${className}`}>{children}</section>;
}

function MetricCard({ label, value, suffix = '', icon, detail, percent }) {
  return <Card><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#777]">{label}</p><p className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">{value ?? '—'}<span className="ml-1 text-base font-medium text-[#858585]">{value == null ? '' : suffix}</span></p></div><span className="rounded-xl border border-white/5 bg-[#151515] p-3 text-[#ccc]"><Icon name={icon} /></span></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#202020]"><div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0}%` }} /></div><p className="mt-3 text-sm text-[#777]">{detail}</p></Card>;
}

function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [activeSubtab, setActiveSubtab] = useState({ latency: 'Scheduling', network: 'Routing & Ping', services: 'Telemetry & Diagnostics', games: 'Fortnite Settings' });
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [logs, setLogs] = useState([{ id: 1, time: new Date(), level: 'INFO', message: 'Booster ready. Live telemetry will appear here.' }]);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState('');
  const [profile, setProfile] = useSavedState('booster:fortnite-profile', Object.fromEntries(PROFILE_OPTIONS.map((x) => [x.id, false])));
  const [network, setNetwork] = useSavedState('booster:network-options', Object.fromEntries(NETWORK_OPTIONS.map((x) => [x.id, false])));
  const [windowsTweaks, setWindowsTweaks] = useSavedState('booster:windows-tweaks', { win32PriorityThreads: false, disableGameDvr: false });
  const [windowsTouched, setWindowsTouched] = useState({});
  const [memoryProcesses, setMemoryProcesses] = useState([]);
  const [selectedProcess, setSelectedProcess] = useState('');
  const [memoryTargets, setMemoryTargets] = useSavedState('booster:per-app-memory-targets', {});
  const [selectedGame, setSelectedGame] = useSavedState('booster:region-game', { value: 'Fortnite' });
  const [regionPreferences, setRegionPreferences] = useSavedState('booster:region-selection', { Fortnite: 'eu-central', Minecraft: 'eu-central', 'Other game': 'eu-central' });
  const selectedRegion = regionPreferences[selectedGame.value] || 'eu-central';
  const [regionProbe, setRegionProbe] = useState(null);
  const [controllerStatus, setControllerStatus] = useState(null);
  const [serviceStatus, setServiceStatus] = useState(null);
  const [networkCheck, setNetworkCheck] = useState(null);
  const [storageOverview, setStorageOverview] = useState(null);
  const [cleanupScan, setCleanupScan] = useState(null);
  const [cleanupSelection, setCleanupSelection] = useState({});
  const [driveBusy, setDriveBusy] = useState('');
  const [storageProgress, setStorageProgress] = useState(null);
  const bridge = typeof window !== 'undefined' ? window.booster : undefined;

  const addLog = useCallback((message, level = 'INFO') => setLogs((items) => [...items, { id: `${Date.now()}-${Math.random()}`, time: new Date(), level, message: String(message) }].slice(-250)), []);
  const notify = useCallback((message, tone = 'neutral') => {
    setToast({ message, tone });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 4000);
  }, []);
  const call = useCallback(async (method, ...args) => {
    if (typeof bridge?.[method] !== 'function') throw new Error(`This build does not yet provide ${method}.`);
    return bridge[method](...args);
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.onLog) return undefined;
    const unsubscribe = bridge.onLog((entry) => entry && addLog(entry.message || String(entry), entry.level || 'INFO'));
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [bridge, addLog]);
  useEffect(() => {
    if (!bridge?.onHardwareMetrics) return undefined;
    const unsubscribe = bridge.onHardwareMetrics((data) => data && setMetrics((previous) => ({ ...previous, ...data })));
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [bridge]);
  useEffect(() => {
    if (!bridge?.onStorageProgress) return undefined;
    return bridge.onStorageProgress((progress) => progress && setStorageProgress(progress));
  }, [bridge]);
  useEffect(() => {
    let alive = true;
    call('getStorageOverview').then((data) => alive && setStorageOverview(data)).catch((error) => alive && addLog(`Drive information: ${error.message}`, 'WARN'));
    return () => { alive = false; };
  }, [call, addLog]);

  const active = NAV_ITEMS.find((item) => item.id === activeTab) || NAV_ITEMS[0];
  const memoryPercent = metrics.memoryUsed != null && metrics.memoryTotal ? (metrics.memoryUsed / metrics.memoryTotal) * 100 : null;
  const selectedCount = cleanupScan?.items?.filter((item) => cleanupSelection[item.id]).length || 0;
  const selectedBytes = cleanupScan?.items?.filter((item) => cleanupSelection[item.id]).reduce((sum, item) => sum + item.bytes, 0) || 0;
  const selectedProcessName = selectedProcess.toLowerCase();
  const memoryTargetPercent = Number(memoryTargets[selectedProcess] ?? MEMORY_TARGET_DEFAULTS[selectedProcessName] ?? 20);

  const run = async (key, label, fn, success = 'Done.') => {
    if (busy) return;
    setBusy(key);
    addLog(label, 'ACTION');
    try {
      const result = parseResult(await fn());
      if (Array.isArray(result.results)) result.results.forEach((item) => addLog(`${item.name || item.id}: ${item.message || item.error || 'completed'}`, item.ok ? 'OK' : 'WARN'));
      else if (result.message) addLog(result.message, result.ok === false ? 'WARN' : 'OK');
      notify(result.ok === false ? 'Completed with some limitations. See Activity Logs.' : success, result.ok === false ? 'amber' : 'green');
      return result;
    } catch (error) {
      addLog(error.message, 'ERROR');
      notify(error.message, 'amber');
      return null;
    } finally { setBusy(''); }
  };

  const launchFortnite = () => run('launch', 'Fortnite launch requested.', () => call('launchFortnite'), 'Fortnite launch request sent to Epic.');
  const optimizeSystem = () => run('optimizer', 'Running the selected system maintenance sequence.', () => call('runOptimizer'), 'System sequence completed. Review Activity Logs.');
  const optimizeMyPc = () => run('winutil', 'Applying the official WinUtil gaming profile, then Booster CPU and memory checks.', async () => {
    const winutil = parseResult(await call('runWinUtilGamingProfile'));
    if (!winutil.ok) return winutil;
    const booster = parseResult(await call('runOptimizer'));
    return { ok: Boolean(winutil.ok && booster.ok), results: [{ name: 'Chris Titus Tech WinUtil profile', ok: Boolean(winutil.ok), message: winutil.message || 'WinUtil completed.' }, ...(booster.results || [])] };
  }, 'Gaming profile and CPU sequence completed. Review Activity Logs.');
  const applyProfile = () => run('profile', 'Applying Fortnite profile (backup first).', () => call('updateFortniteSettings', profile), 'Fortnite profile applied with backup.');
  const applyNetwork = () => run('network', 'Applying the selected Windows network options.', () => call('runNetworkOptimization', { options: NETWORK_OPTIONS.filter((item) => network[item.id]).map((item) => item.id), dns: ['1.1.1.1', '1.0.0.1'] }), 'Selected network changes applied.');
  const applyWindows = () => run('windows', 'Applying selected Windows settings.', async () => {
    const selected = Object.fromEntries(Object.keys(windowsTouched).map((key) => [key, windowsTweaks[key]]));
    const result = parseResult(await call('applyWindowsTweaks', selected));
    if (result.backupPath) addLog(`Backup saved: ${result.backupPath}`, 'INFO');
    if (result.ok) setWindowsTouched({});
    return result;
  }, 'Selected Windows settings applied.');
  const optimizeCpu = () => run('cpu', 'Applying the reversible CPU power profile.', () => call('optimizeCpu'), 'CPU power profile applied; monitor temperature and noise.');
  const scanMemory = async () => {
    const result = await run('memory', 'Scanning large background processes.', () => call('scanBackgroundMemory'), 'Memory scan finished.');
    if (result) { setMemoryProcesses(Array.isArray(result.processes) ? result.processes : []); setSelectedProcess(result.processes?.[0]?.ProcessName || ''); }
  };
  const scanController = async () => {
    const result = await run('controller', 'Checking USB game controllers.', () => call('scanController'), 'Controller scan completed.');
    if (result) setControllerStatus(result);
  };
  const scanServices = async () => {
    const result = await run('services', 'Reading Windows service states (read-only).', () => call('getServiceStatus'), 'Service status scan completed.');
    if (result) setServiceStatus(result.services || []);
  };
  const testConnection = async () => {
    const result = await run('ping', 'Measuring gateway and public ICMP response (not a game-server test).', () => call('measureNetworkQuality'), 'Connection sample completed.');
    if (result) { setNetworkCheck(result); setMetrics((current) => ({ ...current, latency: result.internet?.averageMs ?? null, packetLoss: result.internet?.lossPercent ?? null, adapter: 'ICMP to public test host' })); }
  };
  const testSelectedRegion = async () => {
    const region = selectedRegion || 'eu-central';
    const result = await run('region', `Measuring the ${region} regional probe endpoint.`, () => call('measureRegion', { region }), 'Regional comparison sample complete.');
    if (result) setRegionProbe(result);
  };
  const scanDrive = async (letter) => {
    if (driveBusy) return;
    setDriveBusy(letter); setCleanupScan(null); setCleanupSelection({});
    setStorageProgress({ drive: letter, scannedFiles: 0, candidates: 0, currentDirectory: 'Starting scan…' });
    addLog(`Scanning ${letter}: user files, AppData, and application data with progress reporting.`, 'ACTION');
    try {
      const result = await call('scanDriveCleanup', letter);
      setCleanupScan(result);
      addLog(`${letter}: scan found ${result.candidateCount} candidates (${formatBytes(result.candidateBytes)}).`, 'INFO');
      notify(`Drive ${letter}: scan complete. Review every path.`, 'green');
    } catch (error) { addLog(error.message, 'ERROR'); notify(error.message, 'amber'); }
    finally { setDriveBusy(''); setStorageProgress(null); }
  };
  const removeSelected = async () => {
    const ids = Object.keys(cleanupSelection).filter((id) => cleanupSelection[id]);
    if (!ids.length || busy) return;
    const result = await run('delete', `Requesting confirmation to move ${ids.length} selected file(s) to Recycle Bin.`, () => call('deleteCleanupCandidates', { ids }), 'Selected files moved to Recycle Bin.');
    if (result && !result.cancelled) {
      setCleanupSelection({});
      if (cleanupScan?.drive) {
        try { setCleanupScan(await call('scanDriveCleanup', cleanupScan.drive)); setStorageOverview(await call('getStorageOverview')); } catch (error) { addLog(error.message, 'WARN'); }
      }
    }
  };
  const selectSafeTemps = () => {
    const safe = cleanupScan?.items?.filter((item) => item.category === 'temporary' && item.safeToDelete) || [];
    setCleanupSelection(Object.fromEntries(safe.map((item) => [item.id, true])));
    notify(`${safe.length} older temporary file(s) selected for review. Nothing was deleted.`, 'neutral');
  };
  const updateSubtab = (name) => setActiveSubtab((current) => ({ ...current, [activeTab]: name }));

  const logColor = (level) => ({ OK: 'text-emerald-300', INFO: 'text-[#a2a2a2]', ACTION: 'text-sky-300', WARN: 'text-amber-200', ERROR: 'text-rose-300' }[level] || 'text-[#888]');
  const timeText = (time) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(time instanceof Date ? time : new Date(time));

  const sectionHeader = (eyebrow, title, body) => <div className="mb-6"><Pill>{eyebrow}</Pill><h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-white">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#858585]">{body}</p></div>;
  const subnav = (tab) => <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-white/5 bg-[#080808] p-1.5">{SUBTABS[tab].map((label) => <button key={label} type="button" onClick={() => updateSubtab(label)} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-200 ease-out ${activeSubtab[tab] === label ? 'bg-[#1a1a1a] text-white shadow-sm' : 'text-[#777] hover:text-white'}`}>{label}</button>)}</div>;
  const optionCard = (title, description, right, code = '') => <Card key={title} className="flex flex-wrap items-center gap-5"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold text-white">{title}</h3>{code && <code className="rounded-md border border-white/5 bg-black/40 px-2 py-1 text-[11px] text-[#999]">{code}</code>}</div><p className="mt-2 text-sm leading-6 text-[#777]">{description}</p></div>{right}</Card>;

  const dashboard = () => <div className="space-y-7">
    <Card className="relative overflow-hidden p-8 md:p-10"><div className="pointer-events-none absolute -right-10 -top-24 h-72 w-72 rounded-full bg-white/[0.035] blur-3xl"/><div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div className="max-w-2xl"><Pill tone="green">READY FOR YOUR NEXT SESSION</Pill><h2 className="mt-6 text-4xl font-semibold leading-tight tracking-[-0.055em] text-white md:text-5xl">A smoother session<br/>starts with a clear view.</h2><p className="mt-4 max-w-xl text-base leading-7 text-[#888]">Review the parts of your PC that can affect stutter, storage, audio, and connection stability.</p></div><button onClick={optimizeMyPc} disabled={Boolean(busy)} className="flex min-h-16 items-center justify-between gap-6 rounded-xl bg-white px-6 text-left font-bold text-black transition-colors hover:bg-[#ddd] disabled:opacity-50"><span>{busy==='winutil'?'OPTIMIZING…':'OPTIMIZE MY PC'}</span><Icon name="bolt"/></button></div><p className="relative mt-6 border-t border-white/5 pt-4 text-xs leading-5 text-[#777]">Runs the official WinUtil profile (restore point, Game Mode, performance visual effects), then Booster’s reversible CPU power-plan update and a background-memory scan. Booster itself no longer asks for admin access on startup; Windows may show UAC when the elevated WinUtil step starts. The memory scan identifies apps and does not close them. Results appear in Activity Logs.</p></Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="CPU" value={metrics.cpu} suffix="%" icon="cpu" detail="Intel Core i5-8400 · 6 cores" percent={metrics.cpu}/><MetricCard label="GPU" value={metrics.gpu} suffix="%" icon="signal" detail="NVIDIA GTX 1060 · 6 GB" percent={metrics.gpu}/><MetricCard label="Memory" value={metrics.memoryUsed} suffix={metrics.memoryTotal ? ` / ${metrics.memoryTotal} GB` : ' GB'} icon="memory" detail="System use; per-app targets are advisory" percent={memoryPercent}/><Card><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#777]">Connection sample</p><p className="mt-4 text-3xl font-semibold text-white">{metrics.latency == null ? '—' : `${metrics.latency} ms`}</p><p className="mt-3 text-sm text-[#777]">{metrics.packetLoss == null ? 'Run a test; ICMP is not game-server ping.' : `${metrics.packetLoss}% loss to public test host`}</p></Card></div>
    <div className="grid gap-4 md:grid-cols-2"><button onClick={() => { setActiveTab('network'); setActiveSubtab((s) => ({...s, network:'Routing & Ping'})); }} className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6 text-left transition-colors hover:border-white/10"><Icon name="globe"/><h3 className="mt-4 font-semibold">Connection health</h3><p className="mt-2 text-sm text-[#777]">Sample packet loss and check Epic download conditions.</p></button><button onClick={() => setActiveTab('storage')} className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6 text-left transition-colors hover:border-white/10"><Icon name="disk"/><h3 className="mt-4 font-semibold">Free up SSD space</h3><p className="mt-2 text-sm text-[#777]">Review large files on C: and D: and decide what to remove.</p></button></div>
  </div>;

  const latencyView = () => <div>{sectionHeader('INPUT & FRAME RESPONSE', 'Latency', 'Review input, CPU scheduling, power policy, and wired controller status. Changes are explicit and can be reverted where supported.')}{subnav('latency')}{activeSubtab.latency === 'Scheduling' ? <div className="space-y-4">{optionCard('Win32PrioritySeparation Quantum Tuning','Set Win32PrioritySeparation to 0x26 (38 decimal). Windows scheduling results vary; the previous registry values are backed up.',<Toggle checked={windowsTweaks.win32PriorityThreads} onChange={() => {setWindowsTweaks((v)=>({...v,win32PriorityThreads:!v.win32PriorityThreads}));setWindowsTouched((v)=>({...v,win32PriorityThreads:true}));}} label="Win32 priority tuning"/>,'HKLM\\...\\PriorityControl')}{optionCard('Windows GameDVR Capture','Turn off background game capture for this account and policy. This can affect Windows recording features.',<Toggle checked={windowsTweaks.disableGameDvr} onChange={() => {setWindowsTweaks((v)=>({...v,disableGameDvr:!v.disableGameDvr}));setWindowsTouched((v)=>({...v,disableGameDvr:true}));}} label="Disable GameDVR"/>,'GameDVR_Enabled = 0')}{Object.keys(windowsTouched).length>0&&<div className="flex justify-end"><button onClick={applyWindows} disabled={Boolean(busy)} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{busy==='windows'?'APPLYING…':'APPLY SELECTED TWEAKS'}</button></div>}<Card><h3 className="font-semibold">Measured, reversible changes</h3><p className="mt-2 text-sm leading-6 text-[#777]">Booster does not overclock the i5-8400. It can apply the power-plan profile below, but sustained 100% minimum processor state may increase power use and heat.</p></Card></div> : null}{activeSubtab.latency === 'Keyboard & Mouse' ? <div className="space-y-4">{optionCard('Disable Mouse Acceleration','For a raw 1:1 pointer response, Windows mouse acceleration can be disabled through the Fortnite profile or Windows pointer settings.',<button onClick={()=>run('mouse','Opening Windows mouse settings.',()=>call('openMouseSettings'),'Windows mouse settings opened.')} className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold">OPEN SETTINGS</button>)}<Card><h3 className="font-semibold">Mouse acceleration</h3><p className="mt-2 text-sm text-[#777]">The Fortnite profile toggle writes the requested setting to GameUserSettings.ini when the game supports it.</p></Card></div> : null}{activeSubtab.latency === 'Power Plan' ? <div className="space-y-4">{optionCard('CPU Dynamic Core Performance','Set the active plan’s minimum processor state and core parking policy to a performance-oriented value. A backup is saved; this is not an overclock.',<button onClick={optimizeCpu} disabled={Boolean(busy)} className="rounded-lg bg-white px-4 py-3 text-xs font-bold text-black disabled:opacity-50">{busy==='cpu'?'APPLYING…':'APPLY CPU PROFILE'}</button>)}<Card><p className="text-sm leading-6 text-amber-100/80">This may increase temperature, fan noise, and power use. Watch system temperatures during play and restore the original power plan if needed.</p></Card></div> : null}{activeSubtab.latency === 'Controller' ? <div className="space-y-4"><Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">Wired PlayStation controller</h3><p className="mt-2 text-sm text-[#777]">Check whether Windows currently sees a USB controller. This can’t stop a bad cable, port, or device from disconnecting.</p></div><button onClick={scanController} disabled={Boolean(busy)} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold">{busy==='controller'?'CHECKING…':'DETECT USB CONTROLLER'}</button></div>{controllerStatus&&<div className="mt-5 space-y-2">{controllerStatus.devices?.length?controllerStatus.devices.map((device)=><div key={device.instanceId||device.name} className="flex justify-between gap-3 rounded-lg bg-black/40 p-3 text-sm"><span>{device.name}</span><Pill tone="green">PRESENT</Pill></div>):<p className="rounded-lg bg-black/40 p-3 text-sm text-[#888]">No matching controller was detected. Reconnect the cable and scan again.</p>}</div>}</Card><Card><h3 className="font-semibold">Game input compatibility</h3><p className="mt-2 text-sm leading-6 text-[#777]">A game may expect XInput while a DualShock 4 exposes a different input interface. Booster checks detection and status; it does not install a filter driver or promise lower latency.</p></Card></div> : null}</div>;

  const networkView = () => <div>{sectionHeader('CONNECTION HEALTH', 'Network', 'Measure local and regional connection quality, review packet loss, and troubleshoot Epic download bottlenecks. Regional probes are comparisons, not Fortnite server pings.')}{subnav('network')}{activeSubtab.network === 'Routing & Ping' ? <div className="space-y-4"><Card><div className="flex flex-wrap items-center justify-between gap-5"><div><h3 className="font-semibold">Connection sample</h3><p className="mt-2 text-sm leading-6 text-[#777]">Tests your gateway and a public ICMP host. Run this first to separate local Wi-Fi/router loss from external connection issues.</p></div><button onClick={testConnection} disabled={Boolean(busy)} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{busy==='ping'?'TESTING…':'TEST CONNECTION'}</button></div>{networkCheck&&<div className="mt-5 grid gap-3 md:grid-cols-2">{[['Local gateway',networkCheck.gateway],['Public test host',networkCheck.internet]].map(([name,item])=><div key={name} className="rounded-xl bg-black/40 p-4"><p className="text-xs uppercase tracking-wide text-[#777]">{name}</p><p className="mt-2 text-xl font-semibold">{item?.averageMs==null?'No reply':`${item.averageMs} ms average`}</p><p className="mt-1 text-sm text-[#777]">{item?.lossPercent??'—'}% packet loss · {item?.sent??0} probes</p></div>)}</div>}</Card><Card><div className="flex flex-wrap items-end gap-4"><label className="min-w-[190px] flex-1 text-xs font-semibold uppercase tracking-wide text-[#777]">Game or profile<select value={selectedGame.value} onChange={(event)=>setSelectedGame({ value: event.target.value })} className="mt-2 block w-full rounded-lg border border-white/10 bg-black px-4 py-3 text-sm font-medium normal-case text-white"><option>Fortnite</option><option>Minecraft</option><option>Other game</option></select></label><label className="min-w-[250px] flex-[2] text-xs font-semibold uppercase tracking-wide text-[#777]">Preferred region<select value={selectedRegion} onChange={(event)=>setRegionPreferences((current)=>({...current,[selectedGame.value]:event.target.value}))} className="mt-2 block w-full rounded-lg border border-white/10 bg-black px-4 py-3 text-sm font-medium normal-case text-white">{REGION_OPTIONS.map((region)=><option key={region.id} value={region.id}>{region.label}</option>)}</select></label><button onClick={testSelectedRegion} disabled={Boolean(busy)} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{busy==='region'?'TESTING…':'TEST REGION'}</button></div><p className="mt-4 text-sm leading-6 text-[#888]">Saved separately for each game on this PC. This probes a public cloud endpoint near the selected location; it cannot select Fortnite matchmaking or reroute traffic. Choose the same region inside the game when available. A real ExitLag-style route needs a relay/VPN network.</p>{regionProbe&&<div className="mt-4 grid gap-3 rounded-xl border border-white/5 bg-black/40 p-4 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-[#666]">{REGION_OPTIONS.find((item)=>item.id===regionProbe.region)?.label||regionProbe.region}</p><p className="mt-2 text-2xl font-semibold">{regionProbe.averageMs==null?'No reply':`${regionProbe.averageMs} ms`}</p></div><div><p className="text-xs uppercase tracking-wide text-[#666]">Packet loss</p><p className="mt-2 text-2xl font-semibold">{regionProbe.lossPercent}%</p></div><div><p className="text-xs uppercase tracking-wide text-[#666]">Jitter</p><p className="mt-2 text-2xl font-semibold">{regionProbe.jitterMs==null?'—':`${regionProbe.jitterMs} ms`}</p></div><p className="text-xs leading-5 text-[#666] sm:col-span-3">{regionProbe.note} Host: {regionProbe.host}. Probe node: {REGION_OPTIONS.find((item)=>item.id===regionProbe.region)?.probeHost}.</p></div>}</Card></div> : null}{activeSubtab.network === 'Packet Loss' ? <div className="space-y-4"><Card><h3 className="font-semibold">Packet loss and jitter</h3><p className="mt-2 text-sm leading-6 text-[#777]">Run repeated samples and compare wired gateway results with public-host results. The current diagnostic uses ICMP and cannot prove the path used by Fortnite’s gameplay packets.</p><button onClick={testConnection} disabled={Boolean(busy)} className="mt-4 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">{busy==='ping'?'TESTING…':'RUN PACKET-LOSS SAMPLE'}</button>{networkCheck&&<p className="mt-4 text-sm text-white">Public sample: {networkCheck.internet?.lossPercent ?? '—'}% loss · {networkCheck.internet?.averageMs ?? '—'} ms average. {networkCheck.internet?.jitterMs ?? '—'} ms variation.</p>}</Card><Card><h3 className="font-semibold">If loss appears on the gateway</h3><p className="mt-2 text-sm leading-6 text-[#777]">Check the Ethernet cable, router port, and other devices on the local network. If gateway is clean but internet loss remains, compare another time and contact the ISP with the measurements.</p></Card></div> : null}{activeSubtab.network === 'Epic Downloads' ? <div className="space-y-4"><Card><div className="flex items-start gap-4"><Icon name="disk"/><div><h3 className="font-semibold">Epic Games downloads and verification</h3><p className="mt-2 text-sm leading-6 text-[#777]">Check Epic service status, make sure the Launcher download limit is off, and use Ethernet. Slow verification may be limited by drive reads, especially on an HDD.</p></div></div><ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#999]"><li>In Epic Launcher Settings, check that Download Speed Limit is disabled.</li><li>Exit Epic before clearing its webcache, then relaunch it.</li><li>In Library, open Fortnite’s menu → Manage → Verify. It checks local data and can take time.</li><li>Check free space and drive activity on the install drive before retrying.</li></ol><div className="mt-5 flex flex-wrap gap-3"><button onClick={()=>run('sound','Opening Epic Games Launcher.',()=>call('openEpicLauncher'),'Epic Games Launcher opened.')} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold">OPEN EPIC LAUNCHER</button><button onClick={()=>run('dns','Flushing the Windows DNS cache.',()=>call('runNetworkOptimization',{options:['flushDns']}),'DNS cache flushed.')} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold">FLUSH DNS CACHE</button></div></Card><Card><p className="text-sm leading-6 text-amber-100/80">Changing DNS can help name resolution in some cases; it does not increase the speed of an active download if the ISP, disk, launcher limit, or Epic service is the bottleneck.</p></Card></div> : null}{activeSubtab.network === 'Windows Tweaks' ? <div className="space-y-4">{NETWORK_OPTIONS.map((option)=><Card key={option.id} className="flex flex-wrap items-center gap-5"><div className="min-w-0 flex-1"><h3 className="font-semibold">{option.title}<code className="ml-3 text-xs font-normal text-[#777]">{option.value}</code></h3><p className="mt-2 text-sm leading-6 text-[#777]">{option.description}</p></div><Toggle checked={network[option.id]} onChange={()=>setNetwork((v)=>({...v,[option.id]:!v[option.id]}))} label={option.title}/></Card>)}<div className="flex justify-end"><button onClick={applyNetwork} disabled={Boolean(busy)||!Object.values(network).some(Boolean)} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-40">{busy==='network'?'APPLYING…':'APPLY SELECTED NETWORK CHANGES'}</button></div></div> : null}</div>;

  const servicesView = () => <div>{sectionHeader('WINDOWS BACKGROUND SERVICES', 'Services & Debloat', 'Review service state before making Windows changes. This screen reports status; it does not silently stop update, biometric, or diagnostic services.')}{subnav('services')}{activeSubtab.services === 'Telemetry & Diagnostics' ? <div className="space-y-4"><Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">Service status review</h3><p className="mt-2 text-sm text-[#777]">Read-only scan of the requested service list.</p></div><button onClick={scanServices} disabled={Boolean(busy)} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold">{busy==='services'?'SCANNING…':'SCAN SERVICE STATUS'}</button></div></Card>{SERVICES.map(([name,title,description])=>{const found=serviceStatus?.find((service)=>service.name===name);return <Card key={name}><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">{name}<span className="ml-3 text-sm font-normal text-[#aaa]">{title}</span></h3><p className="mt-2 text-sm text-[#777]">{description}</p></div><Pill tone={found?.status==='Running'?'green':'neutral'}>{found?.status||'NOT SCANNED'}</Pill></div></Card>})}</div> : <div className="space-y-4"><Card><h3 className="font-semibold">Optional Windows components</h3><p className="mt-2 text-sm leading-6 text-[#777]">Review Widgets, OneDrive startup, Xbox overlays, and preinstalled apps here. Booster won’t remove components or disable cloud sync without a dedicated reversible action.</p></Card>{[['Widgets','Disable from Windows Settings → Personalization → Taskbar if you do not use it.'],['OneDrive','Unlink or disable startup from OneDrive settings only if you do not rely on sync.'],['Xbox Game Bar','Turn off captures in Windows Settings if you do not record clips.'],['Windows Update','Keep updates available; do not disable the update service for gaming.']].map(([title,body])=><Card key={title}><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#777]">{body}</p></Card>)}</div>}</div>;

  const gamesView = () => <div>{sectionHeader('FORTNITE & APP MEMORY', 'Games & Apps', 'Tune Fortnite with a backed-up profile, troubleshoot the missing sound cues, and review memory-heavy applications.')}{subnav('games')}{activeSubtab.games === 'Fortnite Settings' ? <div className="space-y-4"><Card className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">Fortnite settings profile</h3><p className="mt-2 text-sm text-[#777]">A .bak copy is created before settings are written. Unsupported settings may be ignored by the game.</p></div><button onClick={applyProfile} disabled={Boolean(busy)} className="rounded-lg bg-white px-5 py-3 text-xs font-bold text-black">{busy==='profile'?'SAVING…':'APPLY PROFILE'}</button></Card>{PROFILE_OPTIONS.map((item)=><Card key={item.id} className="flex flex-wrap items-center gap-5"><div className="min-w-0 flex-1"><h3 className="font-semibold">{item.title}<code className="ml-3 text-xs font-normal text-[#777]">{item.setting}</code></h3><p className="mt-2 text-sm leading-6 text-[#777]">{item.description}</p></div><Toggle checked={profile[item.id]} onChange={()=>setProfile((v)=>({...v,[item.id]:!v[item.id]}))} label={item.title}/></Card>)}<Card><p className="text-sm leading-6 text-amber-100/80">Do not delete random Fortnite animation, sound, or .pak files. The launcher can repair changed files, and unsupported edits can break audio or cause verification to redownload them.</p></Card></div> : null}{activeSubtab.games === 'Audio & Repair' ? <div className="space-y-4"><Card><div className="flex items-start gap-4"><span className="rounded-xl bg-white/[0.06] p-3"><Icon name="sound"/></span><div className="min-w-0 flex-1"><h3 className="font-semibold">Missing gunshots or footsteps</h3><p className="mt-2 text-sm leading-6 text-[#777]">First make sure Fortnite is using the actual headphones or speakers, not a stale “Default output” duplicate. If only some sounds are missing, verify Fortnite and check for a game-side issue.</p></div></div><div className="mt-5 flex flex-wrap gap-3"><button onClick={()=>run('audio','Opening Windows Sound settings.',()=>call('openSoundSettings'),'Windows Sound settings opened.')} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold">OPEN SOUND SETTINGS</button><button onClick={()=>run('epic','Opening Epic Games Launcher.',()=>call('openEpicLauncher'),'Epic Games Launcher opened.')} className="rounded-lg bg-white px-4 py-3 text-xs font-bold text-black">OPEN EPIC FOR VERIFY</button></div></Card><Card><h3 className="font-semibold">In Fortnite Audio settings</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[#888]"><li>Confirm the selected output device and that sound effects are audible in the mixer.</li><li>Try 3D Headphones and Visualize Sound Effects; visual cues can help indicate direction but do not restore missing audio.</li><li>For headphone audio that cuts out at game launch, check the Windows recording device’s exclusive-mode setting.</li></ul><p className="mt-4 text-xs leading-5 text-[#666]">Retrac is a separate community legacy client. Its older assets are not copied into the current Fortnite installation.</p></Card></div> : null}{activeSubtab.games === 'Memory' ? <div className="space-y-4"><Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">System Memory Bloat Sweeper</h3><p className="mt-2 text-sm text-[#777]">Lists background processes using substantial memory. Booster does not close them automatically.</p></div><button onClick={scanMemory} disabled={Boolean(busy)} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold">{busy==='memory'?'SCANNING…':'SCAN MEMORY'}</button></div></Card>{memoryProcesses.length>0&&<Card><label className="text-xs font-semibold uppercase tracking-wide text-[#777]">Choose process to watch<select value={selectedProcess} onChange={(event)=>setSelectedProcess(event.target.value)} className="mt-2 block w-full rounded-lg border border-white/10 bg-black px-3 py-3 text-sm text-white">{memoryProcesses.map((process)=><option key={process.Id} value={process.ProcessName}>{process.ProcessName} · {process.MemoryMB} MB</option>)}</select></label><div className="mt-5 flex flex-wrap items-center justify-between gap-4"><label className="flex flex-1 items-center gap-4 text-sm text-white">Soft target for {selectedProcess}: {memoryTargetPercent}% of system RAM<input type="range" min="5" max="50" value={memoryTargetPercent} onChange={(event)=>setMemoryTargets((current)=>({...current,[selectedProcess]:Number(event.target.value)}))} className="min-w-40 flex-1 accent-white"/></label><span className="text-sm text-[#aaa]">≈ {metrics.memoryTotal ? (metrics.memoryTotal*memoryTargetPercent/100).toFixed(1) : '—'} GB · current {memoryProcesses.find((item)=>item.ProcessName===selectedProcess)?.MemoryMB ?? '—'} MB</span></div><p className="mt-4 text-sm leading-6 text-amber-100/80">This is a saved per-app monitoring target, not a hard memory cap. Windows has no safe seamless per-app RAM ceiling; a strict cap can crash tabs and cause app failures.</p></Card>}<Card><p className="text-sm leading-6 text-[#777]">A memory scan is a snapshot. Use it to identify apps you can close yourself before a game; do not terminate Windows services or unsaved work.</p></Card></div> : null}</div>;

  const storageView = () => <div>{sectionHeader('C: SSD · D: HDD', 'Storage Cleanup', 'Scan user files, AppData, and application data for large files; show their size plus Windows’ reported last-access time. Nothing is deleted automatically.')}<div className="grid gap-4 md:grid-cols-2">{['C','D'].map((letter)=>{const drive=storageOverview?.drives?.find((item)=>item.letter===letter);return <Card key={letter}><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-[#777]">{letter}: {letter==='C'?'SSD':'drive'}</p><p className="mt-2 text-xl font-semibold">{drive?.available?`${formatBytes(drive.freeBytes)} free`:'Checking drive…'}</p></div><button onClick={()=>scanDrive(letter)} disabled={Boolean(driveBusy)||Boolean(busy)||(drive&&!drive.available)} className="rounded-lg border border-white/10 px-4 py-3 text-xs font-bold disabled:opacity-40">{driveBusy===letter?'SCANNING…':`SCAN ${letter}:`}</button></div>{drive?.available&&<><div className="mt-5 h-2 rounded-full bg-[#222]"><div className="h-2 rounded-full bg-white" style={{width:`${Math.max(0,Math.min(100,drive.usedBytes/drive.totalBytes*100))}%`}}/></div><p className="mt-2 text-xs text-[#666]">{formatBytes(drive.usedBytes)} used of {formatBytes(drive.totalBytes)}</p></>}</Card>})}</div>{storageProgress&&<Card className="mt-4"><div className="flex items-center justify-between gap-4"><div><p className="font-semibold">Scanning {storageProgress.drive}: · {storageProgress.scannedFiles.toLocaleString()} files checked</p><p className="mt-1 break-all text-xs text-[#777]">Current folder: {storageProgress.currentDirectory}</p></div><Pill tone="green">{storageProgress.candidates} FOUND</Pill></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#222]"><div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-300"/></div></Card>}<Card className="mt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Scan results</h3><p className="mt-1 text-sm text-[#777]">{cleanupScan?`${cleanupScan.scannedFiles.toLocaleString()} scanned · ${cleanupScan.candidateCount} candidates · ${formatBytes(cleanupScan.candidateBytes)} total`:'Scan a drive to review files.'}</p></div>{cleanupScan&&<button onClick={selectSafeTemps} className="rounded-lg border border-white/10 px-4 py-2.5 text-xs font-bold">SELECT ALL SAFE TEMP FILES</button>}</div>{cleanupScan?.truncated&&<p className="mt-3 rounded-lg bg-amber-200/[0.05] p-3 text-xs text-amber-100">Scan limit reached. Results may be partial.</p>}<div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto">{cleanupScan?.items?.length?cleanupScan.items.map((item)=><div key={item.id} className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/30 p-4"><input type="checkbox" checked={Boolean(cleanupSelection[item.id])} onChange={(event)=>setCleanupSelection((v)=>({...v,[item.id]:event.target.checked}))} className="mt-1 accent-emerald-300"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="break-all text-sm">{item.name}</strong><Pill tone={item.safeToDelete?'green':'amber'}>{item.category==='temporary'?'OLD TEMP':'REVIEW'}</Pill><span className="text-xs text-[#aaa]">{formatBytes(item.bytes)}</span></div><p className="mt-1 break-all font-mono text-[11px] text-[#777]">{item.path}</p><p className="mt-1 text-xs text-[#666]">{item.source} · modified {new Date(item.modifiedUtc).toLocaleDateString()} · last accessed {new Date(item.accessedUtc).toLocaleDateString()} · {item.note}</p></div></div>):cleanupScan?<p className="rounded-lg bg-black/30 p-4 text-sm text-[#777]">No candidates in the scanned locations.</p>:null}</div>{cleanupScan&&<div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#777]">{selectedCount} selected · {formatBytes(selectedBytes)}</p><button onClick={removeSelected} disabled={!selectedCount||Boolean(busy)} className="rounded-xl bg-white px-5 py-3 text-xs font-bold text-black disabled:opacity-40">{busy==='delete'?'WAITING…':'MOVE SELECTED TO RECYCLE BIN'}</button></div>}</Card><Card className="mt-4"><p className="text-sm leading-6 text-[#777]">Windows may disable or defer last-access timestamp updates, so use this date as a clue, not proof that a file is unused. Large personal/AppData files are review-only. Only old Temp files are marked safe; every move is confirmed and goes to Recycle Bin.</p></Card></div>;

  const settingsView = () => <div>{sectionHeader('APP PREFERENCES', 'Settings', 'Booster opens at a compact desktop size and can be resized or maximized.')}<Card><h3 className="font-semibold">System profile</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{[['CPU','Intel Core i5-8400 · 6 cores'],['GPU','NVIDIA GTX 1060 · 6 GB'],['Memory','16 GB installed'],['Display','1080p · 144 Hz target']].map(([k,v])=><div key={k} className="rounded-xl bg-black/30 p-4"><p className="text-xs uppercase tracking-wide text-[#777]">{k}</p><p className="mt-2 text-sm font-semibold">{v}</p></div>)}</div><p className="mt-4 text-xs text-[#666]">Hardware labels are your provided profile; live readings are shown only when Windows telemetry returns them.</p></Card><Card className="mt-4"><h3 className="font-semibold">About actions and backups</h3><p className="mt-2 text-sm leading-6 text-[#777]">Fortnite profile and Windows registry changes save backups where supported. Review logs to see actions and errors. Booster avoids automatic deletion of game files and does not install controller drivers.</p></Card></div>;

  const logsView = () => <div>{sectionHeader('APP ACTIVITY', 'Activity Logs', 'Readable action history from the main process. Clear the visible session log at any time.')}<Card><div className="mb-4 flex items-center justify-between"><p className="text-sm text-[#777]">{logs.length} entries</p><button onClick={()=>setLogs([])} className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold">CLEAR LOG</button></div><div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-xl border border-white/5 bg-black p-4 font-mono text-xs">{logs.length?logs.map((entry)=><div key={entry.id} className="grid grid-cols-[70px_60px_1fr] gap-3"><time className="text-[#555]">{timeText(entry.time)}</time><span className={`font-bold ${logColor(entry.level)}`}>{entry.level}</span><span className="break-words text-[#aaa]">{entry.message}</span></div>):<p className="text-[#666]">No activity recorded.</p>}</div></Card></div>;

  const renderContent = () => {
    if (activeTab==='home') return dashboard();
    if (activeTab==='latency') return latencyView();
    if (activeTab==='network') return networkView();
    if (activeTab==='services') return servicesView();
    if (activeTab==='games') return gamesView();
    if (activeTab==='storage') return storageView();
    if (activeTab==='logs') return logsView();
    return settingsView();
  };

  return <div className="flex h-screen min-h-[620px] w-full overflow-hidden bg-black font-sans text-white selection:bg-white/20">
    <aside className="flex w-[250px] shrink-0 flex-col border-r border-white/5 bg-black px-4 py-5 xl:w-[280px] xl:px-5"><div className="flex items-center gap-3 px-2"><div className="grid h-11 w-11 place-items-center rounded-[14px] bg-white text-black"><Icon name="bolt" size={24}/></div><div><p className="text-lg font-extrabold tracking-[-0.04em]">BOOSTER</p><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666]">Performance console</p></div></div><p className="mt-9 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#555]">Workspace</p><nav className="relative mt-3 space-y-1.5" aria-label="Main navigation"><span className="pointer-events-none absolute left-0 top-0 h-[48px] w-full rounded-xl border border-white/5 bg-[#111] transition-transform duration-200 ease-out" style={{transform:`translateY(${NAV_ITEMS.findIndex((item)=>item.id===activeTab)*54}px)`}}/>{NAV_ITEMS.map((item)=>{const isActive=activeTab===item.id;return <button key={item.id} onClick={()=>setActiveTab(item.id)} className={`relative z-10 flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors duration-200 ${isActive?'text-white':'text-[#777] hover:text-white'}`}><Icon name={item.icon} size={18}/><span className="text-sm font-semibold">{item.label}</span>{isActive&&<span className="ml-auto h-1.5 w-1.5 rounded-full bg-white"/>}</button>})}</nav><div className="mt-auto space-y-3"><div className="rounded-xl border border-white/5 bg-[#0d0d0d] p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#777]">Status</span><span className="h-2 w-2 rounded-full bg-emerald-400"/></div><p className="mt-2 text-sm font-semibold">Ready for your session</p><p className="mt-1 text-xs leading-5 text-[#666]">Updates and errors appear in Activity Logs.</p></div><button onClick={launchFortnite} disabled={Boolean(busy)} className="group flex min-h-[66px] w-full items-center justify-between rounded-xl bg-white px-4 text-black transition-colors hover:bg-[#ddd] disabled:opacity-50"><span className="text-left"><span className="block text-[9px] font-bold tracking-[0.18em] text-black/55">READY WHEN YOU ARE</span><span className="mt-1 block text-base font-extrabold">LAUNCH FORTNITE</span></span><span className="grid h-9 w-9 place-items-center rounded-lg bg-black text-white"><Icon name="arrow" size={18}/></span></button></div></aside>
    <main className="min-w-0 flex-1 overflow-y-auto bg-black px-5 py-5 sm:px-7 lg:px-9"><header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-5"><div><p className="text-xs font-medium text-[#666]">Booster <span className="px-2 text-[#444]">/</span><span className="text-[#aaa]">{active.label}</span></p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{active.label}</h1></div><div className="flex items-center gap-3"><Pill tone={bridge?'green':'amber'}>{bridge?'MAIN PROCESS CONNECTED':'PREVIEW MODE'}</Pill><button title="Activity logs" onClick={()=>setActiveTab('logs')} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#111]"><Icon name="activity" size={17}/></button></div></header><div key={`${activeTab}-${activeSubtab[activeTab]||''}`} className="animate-[booster-enter_200ms_ease-out_both]">{renderContent()}</div></main>
    {toast&&<div role="status" className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${toast.tone==='green'?'border-emerald-300/20 bg-[#0d1712] text-emerald-100':toast.tone==='amber'?'border-amber-300/20 bg-[#19150c] text-amber-100':'border-white/10 bg-[#111] text-white'}`}>{toast.message}</div>}
    <style>{'@keyframes booster-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}'}</style>
  </div>;
}

export default App;
