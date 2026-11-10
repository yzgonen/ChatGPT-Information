import React, { useCallback, useEffect, useMemo, useState } from 'react';

const NAV_ITEMS = [
  { id: 'home', label: 'Overview', icon: 'grid' },
  { id: 'fortnite', label: 'Fortnite Profile', icon: 'gamepad' },
  { id: 'connection', label: 'Connection', icon: 'globe' },
  { id: 'settings', label: 'Settings', icon: 'sliders' }
];

const PROFILE_OPTIONS = [
  {
    id: 'lobbyAnimations',
    title: 'Strip Lobby Animations',
    description: 'Reduce background motion in the lobby.',
    setting: 'bShowLobbyBackground',
    enabledValue: false,
    disabledValue: true
  },
  {
    id: 'mobileRenderPathway',
    title: 'Mobile Render Pathway',
    description: 'Request the ES31 rendering path. Fortnite may ignore unsupported values.',
    setting: 'D3DRHIPreference',
    enabledValue: 'ES31',
    disabledValue: 'Default'
  },
  {
    id: 'grassRemoval',
    title: 'Absolute Grass Removal',
    description: 'Disable grass where the current Fortnite build supports this setting.',
    setting: 'bShowGrass',
    enabledValue: false,
    disabledValue: true
  },
  {
    id: 'foliageMotion',
    title: 'Reduce Tree / Plant Motion',
    description: 'Set foliage quality to zero in the scalability profile.',
    setting: 'sg.FoliageQuality',
    enabledValue: 0,
    disabledValue: 2
  },
  {
    id: 'mouseAcceleration',
    title: 'Disable Mouse Acceleration',
    description: 'Write the requested Fortnite mouse setting when supported by the game.',
    setting: 'bDisableMouseAcceleration',
    enabledValue: true,
    disabledValue: false
  }
];

const NETWORK_OPTIONS = [
  { id: 'tcpNoDelay', title: 'TCP No Delay', value: 'TCPNoDelay = 1', description: 'Request immediate transmission for eligible TCP traffic.' },
  { id: 'tcpAckFrequency', title: 'TCP ACK Frequency', value: 'TCPAckFrequency = 1', description: 'Request prompt acknowledgements on the selected interface.' },
  { id: 'disableThrottling', title: 'Disable Network Throttling', value: 'NetworkThrottlingIndex = ffffffff', description: 'Remove Windows multimedia network throttling.' },
  { id: 'flushDns', title: 'Flush DNS Cache', value: 'ipconfig /flushdns', description: 'Clear the local resolver cache once when applying.' },
  { id: 'cloudflareDns', title: 'Cloudflare DNS', value: '1.1.1.1 / 1.0.0.1', description: 'Set the selected adapter DNS servers to Cloudflare.' },
  { id: 'tcpAutoTuning', title: 'TCP Auto-Tuning', value: 'autotuninglevel = normal', description: 'Keep Windows receive-window auto-tuning at the normal setting.' }
];

const INITIAL_METRICS = {
  cpu: null,
  gpu: null,
  memoryUsed: null,
  memoryTotal: 16,
  latency: null,
  adapter: 'Waiting for system telemetry'
};

function parseBridgeResult(result) {
  if (typeof result !== 'string') return result || {};
  try { return JSON.parse(result); } catch { return { message: result }; }
}

function Icon({ name, size = 20, className = '' }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true
  };

  const paths = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    gamepad: <><path d="M6.2 9.2h11.6a4.1 4.1 0 0 1 4 4.9l-.5 2.7a2.7 2.7 0 0 1-4.5 1.5l-2-1.8H9.2l-2 1.8a2.7 2.7 0 0 1-4.5-1.5l-.5-2.7a4.1 4.1 0 0 1 4-4.9Z" /><path d="M7 11.8v4M5 13.8h4M16.5 13h.01M19 15.5h.01" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" /></>,
    sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /><path d="M10 10h4v4h-4z" /></>,
    memory: <><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M19 10v4M6 17v3M10 17v3M14 17v3M18 17v3" /></>,
    signal: <><path d="M3 20h2v-3H3zM8 20h2v-7H8zM13 20h2V9h-2zM18 20h2V4h-2z" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    warning: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 16h.01" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.7 9A8 8 0 0 1 19 6l1 1M4 17v-5h5" /><path d="M19.3 15A8 8 0 0 1 5 18l-1-1" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>
  };

  return <svg {...common}>{paths[name] || paths.grid}</svg>;
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-8 w-[56px] shrink-0 rounded-full border transition-colors duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-white/30 ${checked ? 'border-white bg-white' : 'border-white/10 bg-[#202020]'}`}
    >
      <span className={`absolute left-[3px] top-[3px] h-6 w-6 rounded-full transition-transform duration-200 ease-out ${checked ? 'translate-x-6 bg-black' : 'translate-x-0 bg-[#858585]'}`} />
    </button>
  );
}

function MetricCard({ label, value, suffix, icon, detail, percent }) {
  const showProgress = Number.isFinite(percent);
  return (
    <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#777]">{label}</p>
          <p className="mt-4 text-[34px] font-semibold leading-none tracking-[-0.04em] text-white">
            {value ?? '—'}<span className="ml-1 text-lg font-medium text-[#8a8a8a]">{value == null ? '' : suffix}</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-[#151515] p-3 text-[#c8c8c8]"><Icon name={icon} size={22} /></div>
      </div>
      {showProgress ? (
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#202020]">
          <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
      ) : <div className="mt-6 h-2 rounded-full bg-[#202020]" />}
      <p className="mt-3 text-sm text-[#747474]">{detail}</p>
    </div>
  );
}

function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-white/10 bg-white/[0.04] text-[#aaa]',
    green: 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300',
    amber: 'border-amber-400/15 bg-amber-400/[0.07] text-amber-200'
  };
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide ${tones[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === 'green' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-300' : 'bg-[#777]'}`} />{children}</span>;
}

function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [optimizing, setOptimizing] = useState(false);
  const [applyingProfile, setApplyingProfile] = useState(false);
  const [applyingNetwork, setApplyingNetwork] = useState(false);
  const [applyingWindows, setApplyingWindows] = useState(false);
  const [windowsTweaks, setWindowsTweaks] = useState({ win32PriorityThreads: false, disableGameDvr: false });
  const [windowsTouched, setWindowsTouched] = useState({});
  const [optimizingCpu, setOptimizingCpu] = useState(false);
  const [scanningMemory, setScanningMemory] = useState(false);
  const [memoryProcesses, setMemoryProcesses] = useState([]);
  const [profile, setProfile] = useState({
    lobbyAnimations: false,
    mobileRenderPathway: false,
    grassRemoval: false,
    foliageMotion: false,
    mouseAcceleration: false
  });
  const [network, setNetwork] = useState(Object.fromEntries(NETWORK_OPTIONS.map((item) => [item.id, true])));
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [logs, setLogs] = useState([
    { id: 1, time: new Date(), level: 'INFO', message: 'Booster dashboard initialized.' },
    { id: 2, time: new Date(), level: 'INFO', message: 'System profile: i5-8400 · GTX 1060 6 GB · 16 GB RAM.' },
    { id: 3, time: new Date(), level: 'WAIT', message: 'Waiting for live telemetry from the main process.' }
  ]);
  const [toast, setToast] = useState(null);
  const bridge = typeof window !== 'undefined' ? window.booster : undefined;

  const appendLog = useCallback((message, level = 'INFO') => {
    setLogs((current) => [...current, { id: `${Date.now()}-${Math.random()}`, time: new Date(), level, message: String(message) }].slice(-120));
  }, []);

  const notify = useCallback((message, tone = 'neutral') => {
    setToast({ message, tone });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(() => {
    if (!bridge?.onLog) return undefined;
    const unsubscribe = bridge.onLog((entry) => {
      if (typeof entry === 'string') appendLog(entry);
      else if (entry) appendLog(entry.message || JSON.stringify(entry), entry.level || 'INFO');
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [bridge, appendLog]);

  useEffect(() => {
    if (!bridge?.onHardwareMetrics) return undefined;
    const unsubscribe = bridge.onHardwareMetrics((snapshot) => {
      if (snapshot && typeof snapshot === 'object') setMetrics((current) => ({ ...current, ...snapshot }));
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [bridge]);

  useEffect(() => {
    const node = document.getElementById('booster-console-end');
    node?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }, [logs]);

  const activeIndex = Math.max(0, NAV_ITEMS.findIndex((item) => item.id === activeTab));
  const activeTitle = NAV_ITEMS[activeIndex]?.label || 'Overview';
  const memoryPercent = Number.isFinite(metrics.memoryUsed) && Number.isFinite(metrics.memoryTotal) && metrics.memoryTotal > 0
    ? (metrics.memoryUsed / metrics.memoryTotal) * 100
    : null;

  const profilePayload = useMemo(() => {
    const payload = {};
    for (const option of PROFILE_OPTIONS) payload[option.id] = Boolean(profile[option.id]);
    return payload;
  }, [profile]);

  const callBridge = async (methodName, ...args) => {
    const method = bridge?.[methodName];
    if (typeof method !== 'function') {
      const message = `Main-process bridge method “${methodName}” is not available yet.`;
      appendLog(message, 'WARN');
      notify('This action needs its main-process and preload bridge handler.', 'amber');
      throw new Error(message);
    }
    return method(...args);
  };

  const runOptimizer = async () => {
    if (optimizing) return;
    setOptimizing(true);
    appendLog('One-click optimizer requested.', 'ACTION');
    try {
      const result = await callBridge('runOptimizer');
      for (const item of result?.results || []) {
        appendLog(item.ok ? `${item.name}: ${typeof item.details === 'string' ? item.details : JSON.stringify(item.details)}` : `${item.name}: ${item.error}`, item.ok ? 'OK' : 'WARN');
      }
      notify(result?.ok ? 'Optimization sequence completed.' : 'Sequence completed with some steps unavailable.', result?.ok ? 'green' : 'amber');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    } finally {
      setOptimizing(false);
    }
  };

  const launchFortnite = async () => {
    appendLog('Fortnite launch requested through the Epic Games protocol.', 'ACTION');
    try {
      await callBridge('launchFortnite');
      appendLog('Epic Games launch protocol handed to Windows.', 'OK');
      notify('Fortnite launch request sent.', 'green');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    }
  };

  const applyProfile = async () => {
    if (applyingProfile) return;
    setApplyingProfile(true);
    appendLog('Applying selected Fortnite profile values.', 'ACTION');
    try {
      const result = await callBridge('updateFortniteSettings', profilePayload);
      appendLog(result?.changed ? `Fortnite profile saved. Backup: ${result.backupPath || 'created'}` : (result?.message || 'Fortnite profile already matches.'), result?.changed ? 'OK' : 'INFO');
      notify('Fortnite profile settings sent.', 'green');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    } finally {
      setApplyingProfile(false);
    }
  };

  const runNetworkOptimization = async () => {
    if (applyingNetwork) return;
    setApplyingNetwork(true);
    appendLog('Windows network optimization requested. Review the selected changes before applying.', 'ACTION');
    try {
      const selectedOptions = NETWORK_OPTIONS.filter((item) => network[item.id]).map((item) => item.id);
      const result = await callBridge('runNetworkOptimization', { options: selectedOptions, dns: ['1.1.1.1', '1.0.0.1'], region: 'Frankfurt, Germany', latencyTargetMs: 145 });
      for (const item of result?.results || []) appendLog(`${item.name}: ${item.message || item.error || 'completed'}`, item.ok ? 'OK' : 'WARN');
      notify(result?.ok ? 'Selected network changes applied.' : 'Network sequence finished with reported limitations.', result?.ok ? 'green' : 'amber');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    } finally {
      setApplyingNetwork(false);
    }
  };

  const runCpuOptimization = async () => {
    if (optimizingCpu) return;
    setOptimizingCpu(true);
    appendLog('CPU dynamic core performance requested.', 'ACTION');
    try {
      const result = parseBridgeResult(await callBridge('optimizeCpu'));
      appendLog(result.message || `CPU power profile updated. Backup: ${result.backupPath || 'saved'}`, 'OK');
      notify('CPU performance profile applied.', 'green');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    } finally {
      setOptimizingCpu(false);
    }
  };

  const scanBackgroundMemory = async () => {
    if (scanningMemory) return;
    setScanningMemory(true);
    appendLog('Background memory scan requested.', 'ACTION');
    try {
      const result = parseBridgeResult(await callBridge('scanBackgroundMemory'));
      const rows = Array.isArray(result.processes) ? result.processes : [];
      setMemoryProcesses(rows);
      appendLog(result.message || `Background scan found ${rows.length} candidate process(es).`, 'INFO');
      for (const process of rows) appendLog(`${process.ProcessName || process.processName || 'Process'} · ${process.MemoryMB ?? process.memoryMB ?? '?'} MB · PID ${process.Id ?? process.id ?? '?'}`, 'INFO');
      notify(`Scan complete: ${rows.length} background process(es) listed.`, 'green');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    } finally {
      setScanningMemory(false);
    }
  };

  const applyWindowsSettings = async () => {
    if (applyingWindows) return;
    const selected = Object.fromEntries(Object.keys(windowsTouched).map((key) => [key, windowsTweaks[key]]));
    if (!Object.keys(selected).length) return;
    setApplyingWindows(true);
    appendLog('Applying selected Windows system settings.', 'ACTION');
    try {
      const result = parseBridgeResult(await callBridge('applyWindowsTweaks', selected));
      for (const item of result.results || []) appendLog(`${item.name}: ${item.message || item.error || 'completed'}`, item.ok ? 'OK' : 'WARN');
      if (result.backupPath) appendLog(`Windows settings backup saved: ${result.backupPath}`, 'INFO');
      if (result.ok) {
        setWindowsTouched({});
        notify('Selected Windows settings applied.', 'green');
      } else notify('Some Windows settings could not be applied.', 'amber');
    } catch (error) {
      appendLog(error.message, 'ERROR');
    } finally {
      setApplyingWindows(false);
    }
  };

  const toggleProfile = (id) => setProfile((current) => ({ ...current, [id]: !current[id] }));
  const toggleNetwork = (id) => setNetwork((current) => ({ ...current, [id]: !current[id] }));
  const toggleWindowsTweak = (id) => {
    setWindowsTweaks((current) => ({ ...current, [id]: !current[id] }));
    setWindowsTouched((current) => ({ ...current, [id]: true }));
  };

  const renderHome = () => (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[28px] border border-white/5 bg-[#0d0d0d] p-9 lg:p-11">
        <div className="pointer-events-none absolute -right-12 -top-28 h-80 w-80 rounded-full bg-white/[0.035] blur-3xl" />
        <div className="relative flex flex-col justify-between gap-8 xl:flex-row xl:items-end">
          <div className="max-w-2xl">
            <StatusPill tone="green">SYSTEM READY</StatusPill>
            <h2 className="mt-7 text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] text-white lg:text-[54px]">Every frame,<br />with less friction.</h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-[#8a8a8a]">Run the Booster maintenance sequence, tune your Fortnite profile, and review system activity in one place.</p>
          </div>
          <button type="button" onClick={runOptimizer} disabled={optimizing} className="group inline-flex min-h-[76px] min-w-[300px] items-center justify-between gap-5 rounded-2xl bg-white px-7 text-left text-black transition-all duration-200 hover:bg-[#dedede] disabled:cursor-wait disabled:opacity-60">
            <span><span className="block text-xs font-bold tracking-[0.18em] text-black/55">{optimizing ? 'WORKING' : 'ONE CLICK'}</span><span className="mt-1 block text-xl font-bold tracking-[-0.02em]">{optimizing ? 'OPTIMIZING…' : 'AUTO-OPTIMIZE SYSTEM'}</span></span>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-black text-white transition-transform duration-200 group-hover:scale-105"><Icon name={optimizing ? 'refresh' : 'bolt'} size={21} /></span>
          </button>
        </div>
        <div className="relative mt-9 flex flex-wrap gap-3 border-t border-white/5 pt-6">
          <StatusPill>Windows 11</StatusPill><StatusPill>144 Hz display</StatusPill><StatusPill>Fortnite profile ready</StatusPill>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-xl font-semibold tracking-tight text-white">System snapshot</h3><span className="text-sm text-[#737373]">Live values appear when telemetry is connected</span></div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Processor" value={metrics.cpu} suffix="%" icon="cpu" detail="Intel Core i5-8400 · 6 cores" percent={metrics.cpu} />
          <MetricCard label="Graphics" value={metrics.gpu} suffix="%" icon="signal" detail="NVIDIA GeForce GTX 1060 · 6 GB" percent={metrics.gpu} />
          <MetricCard label="Memory" value={metrics.memoryUsed} suffix={metrics.memoryUsed == null ? '' : ` / ${metrics.memoryTotal} GB`} icon="memory" detail="16 GB installed" percent={memoryPercent} />
        </div>
      </section>

      <section className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-7">
        <div className="flex items-center justify-between"><div><h3 className="text-xl font-semibold text-white">Quick actions</h3><p className="mt-1 text-sm text-[#777]">Jump straight to the controls you use most.</p></div><Icon name="arrow" className="text-[#666]" /></div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <button type="button" onClick={() => setActiveTab('fortnite')} className="flex items-center gap-4 rounded-xl border border-white/5 bg-[#121212] p-5 text-left transition-colors hover:border-white/10 hover:bg-[#171717]"><span className="rounded-xl bg-white/[0.06] p-3 text-white"><Icon name="gamepad" /></span><span><span className="block font-semibold text-white">Fortnite profile</span><span className="mt-1 block text-sm text-[#777]">Apply your selected game settings</span></span></button>
          <button type="button" onClick={() => setActiveTab('connection')} className="flex items-center gap-4 rounded-xl border border-white/5 bg-[#121212] p-5 text-left transition-colors hover:border-white/10 hover:bg-[#171717]"><span className="rounded-xl bg-white/[0.06] p-3 text-white"><Icon name="globe" /></span><span><span className="block font-semibold text-white">Connection suite</span><span className="mt-1 block text-sm text-[#777]">Review Windows network settings</span></span></button>
        </div>
      </section>
    </div>
  );

  const renderFortnite = () => (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 rounded-[26px] border border-white/5 bg-[#0d0d0d] p-8 lg:flex-row lg:items-end lg:p-9">
        <div><StatusPill>GAME PROFILE</StatusPill><h2 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-white">Fortnite settings</h2><p className="mt-3 max-w-2xl text-base leading-7 text-[#858585]">Choose the profile values to write to GameUserSettings.ini. A backup should be created by the main process before changes are saved.</p></div>
        <button type="button" onClick={applyProfile} disabled={applyingProfile} className="inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-white px-6 text-base font-bold text-black transition-colors hover:bg-[#ddd] disabled:opacity-50">{applyingProfile ? 'APPLYING…' : 'APPLY PROFILE'}<Icon name="arrow" size={18} /></button>
      </section>

      <section className="space-y-3">
        {PROFILE_OPTIONS.map((option, index) => (
          <article key={option.id} className="flex items-center gap-5 rounded-2xl border border-white/5 bg-[#0d0d0d] p-6 transition-colors duration-200 hover:border-white/10">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/5 bg-[#151515] text-sm font-semibold text-[#777]">0{index + 1}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-semibold text-white">{option.title}</h3><code className="rounded-md border border-white/5 bg-black/40 px-2.5 py-1 text-xs text-[#999]">{option.setting}</code></div><p className="mt-2 text-sm leading-6 text-[#777]">{option.description}</p></div>
            <Toggle checked={profile[option.id]} onChange={() => toggleProfile(option.id)} label={option.title} />
          </article>
        ))}
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-amber-300/10 bg-amber-200/[0.035] p-5 text-sm leading-6 text-[#aaa]"><Icon name="warning" className="mt-0.5 shrink-0 text-amber-200" size={18} /><p>Fortnite updates can rename, ignore, or overwrite configuration keys. The main process should validate these keys and preserve a restorable <code className="text-amber-100">.bak</code> before writing.</p></div>
    </div>
  );

  const renderConnection = () => (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-[26px] border border-white/5 bg-[#0d0d0d] p-8 lg:p-9">
        <div className="flex flex-wrap items-start justify-between gap-6"><div><StatusPill tone="amber">WINDOWS NETWORK SETTINGS</StatusPill><h2 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-white">Connection suite</h2><p className="mt-3 max-w-2xl text-base leading-7 text-[#858585]">Review each requested Windows network change before applying it to the selected adapter.</p></div><div className="rounded-2xl border border-white/5 bg-black/30 px-5 py-4 text-right"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#777]">Route objective</p><p className="mt-2 text-2xl font-semibold text-white">Frankfurt <span className="text-base font-medium text-[#777]">· Germany</span></p><p className="mt-1 text-sm text-[#888]">145 ms target estimate</p></div></div>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300/10 bg-amber-200/[0.035] p-4 text-sm leading-6 text-[#aaa]"><Icon name="warning" className="mt-0.5 shrink-0 text-amber-200" size={18} /><p>Windows DNS and TCP settings cannot select an ISP route or guarantee 145 ms latency. Actual routing and ping depend on your ISP, game server, and current network path. DNS changes can affect every app on the selected adapter.</p></div>
      </section>

      <section className="space-y-3">
        {NETWORK_OPTIONS.map((option) => (
          <article key={option.id} className="flex items-center gap-5 rounded-2xl border border-white/5 bg-[#0d0d0d] p-5 transition-colors duration-200 hover:border-white/10">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold text-white">{option.title}</h3><code className="rounded-md border border-white/5 bg-black/40 px-2 py-1 text-[11px] text-[#999]">{option.value}</code></div><p className="mt-2 text-sm leading-6 text-[#777]">{option.description}</p></div>
            <Toggle checked={network[option.id]} onChange={() => toggleNetwork(option.id)} label={option.title} />
          </article>
        ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#0d0d0d] p-6"><div><p className="font-semibold text-white">Apply selected changes</p><p className="mt-1 text-sm text-[#777]">The main process should request Windows permission and report each result.</p></div><button type="button" onClick={runNetworkOptimization} disabled={applyingNetwork || !Object.values(network).some(Boolean)} className="inline-flex h-14 items-center gap-3 rounded-xl bg-white px-6 font-bold text-black transition-colors hover:bg-[#ddd] disabled:cursor-not-allowed disabled:opacity-40">{applyingNetwork ? 'APPLYING…' : 'APPLY NETWORK TWEAKS'}<Icon name="arrow" size={18} /></button></div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-7">
      <section className="rounded-[26px] border border-white/5 bg-[#0d0d0d] p-8"><StatusPill>GENERAL WINDOWS SYSTEM</StatusPill><h2 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-white">Windows settings</h2><p className="mt-3 text-base leading-7 text-[#858585]">Review system controls for the i5-8400, GTX 1060, and 16 GB memory profile.</p></section>
      <section className="grid gap-4 md:grid-cols-2">
        {[
          ['Processor', 'Intel Core i5-8400', '6 cores · 2.80 GHz'],
          ['Graphics', 'NVIDIA GeForce GTX 1060', '6 GB dedicated VRAM'],
          ['Memory', '16 GB RAM', 'Windows reports 16,214 MB available'],
          ['Display', '1920 × 1080', '144 Hz active mode']
        ].map(([label, value, detail]) => <div key={label} className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#777]">{label}</p><p className="mt-4 text-xl font-semibold text-white">{value}</p><p className="mt-2 text-sm text-[#777]">{detail}</p></div>)}
      </section>
      <section className="space-y-4">
        <article className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-white/5 bg-[#151515] p-3 text-white"><Icon name="cpu" size={22} /></div>
            <div className="min-w-0 flex-1"><h3 className="text-lg font-semibold text-white">CPU Dynamic Core Performance</h3><p className="mt-2 text-sm leading-6 text-[#777]">Disable Windows core parking and set minimum processor performance to 100%. Previous power-plan values are backed up. This changes power policy; it does not overclock the CPU.</p><p className="mt-2 text-xs leading-5 text-amber-100/70">This keeps the CPU at a high minimum state and can increase power use and heat.</p></div>
            <button type="button" onClick={runCpuOptimization} disabled={optimizingCpu} className="shrink-0 rounded-xl bg-white px-4 py-3 text-xs font-bold text-black transition-colors hover:bg-[#ddd] disabled:opacity-50">{optimizingCpu ? 'APPLYING…' : 'APPLY CPU PROFILE'}</button>
          </div>
        </article>

        <article className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-white/5 bg-[#151515] p-3 text-white"><Icon name="memory" size={22} /></div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-semibold text-white">System Memory Bloat Sweeper</h3><StatusPill>{scanningMemory ? 'SCANNING' : `${memoryProcesses.length} FOUND`}</StatusPill></div><p className="mt-2 text-sm leading-6 text-[#777]">Scan for large background processes using at least 150 MB. Results are listed for review; apps and browser update services are left running.</p></div>
            <button type="button" onClick={scanBackgroundMemory} disabled={scanningMemory} className="shrink-0 rounded-xl border border-white/10 bg-[#171717] px-4 py-3 text-xs font-bold text-white transition-colors hover:bg-[#222] disabled:opacity-50">{scanningMemory ? 'SCANNING…' : 'SCAN MEMORY'}</button>
          </div>
          <div className="mt-5 max-h-36 space-y-2 overflow-y-auto rounded-xl border border-white/5 bg-black/50 p-3 font-mono text-xs">
            {memoryProcesses.length ? memoryProcesses.map((process, index) => <div key={`${process.Id ?? process.id ?? index}-${process.ProcessName ?? process.processName ?? 'process'}`} className="flex items-center justify-between gap-3 text-[#aaa]"><span className="truncate">{process.ProcessName || process.processName || 'Process'} <span className="text-[#666]">PID {process.Id ?? process.id ?? '—'}</span></span><span className="shrink-0 text-white">{process.MemoryMB ?? process.memoryMB ?? '—'} MB</span></div>) : <p className="text-[#666]">Run a scan to list background memory users.</p>}
          </div>
        </article>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/5 bg-[#0d0d0d] p-6">
        <div><h3 className="text-lg font-semibold text-white">Windows system tweaks</h3><p className="mt-1 text-sm leading-6 text-[#777]">Choose values, then apply. Previous registry values are saved to a backup file.</p></div>
        <article className="flex items-center gap-4 rounded-xl border border-white/5 bg-black/30 p-4">
          <div className="min-w-0 flex-1"><h4 className="text-base font-semibold text-white">Accelerate Win32 Priority Threads</h4><p className="mt-1 text-sm leading-5 text-[#777]">Set Win32PrioritySeparation to 26 to adjust thread quantum behavior.</p></div>
          <Toggle checked={windowsTweaks.win32PriorityThreads} onChange={() => toggleWindowsTweak('win32PriorityThreads')} label="Accelerate Win32 Priority Threads" />
        </article>
        <article className="flex items-center gap-4 rounded-xl border border-white/5 bg-black/30 p-4">
          <div className="min-w-0 flex-1"><h4 className="text-base font-semibold text-white">Destroy Windows GameDVR Captures</h4><p className="mt-1 text-sm leading-5 text-[#777]">Disable GameDVR capture settings for the current account and Windows policy.</p></div>
          <Toggle checked={windowsTweaks.disableGameDvr} onChange={() => toggleWindowsTweak('disableGameDvr')} label="Destroy Windows GameDVR Captures" />
        </article>
        <div className="flex items-center justify-between gap-4 pt-2"><p className="text-xs leading-5 text-[#666]">Windows may request administrator permission for machine-wide policy keys.</p><button type="button" onClick={applyWindowsSettings} disabled={applyingWindows || !Object.keys(windowsTouched).length} className="shrink-0 rounded-xl bg-white px-5 py-3 text-xs font-bold text-black transition-colors hover:bg-[#ddd] disabled:cursor-not-allowed disabled:opacity-40">{applyingWindows ? 'APPLYING…' : 'APPLY WINDOWS TWEAKS'}</button></div>
      </section>

      <section className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-6"><div className="flex items-center gap-4"><div className="rounded-xl bg-white/[0.06] p-3 text-white"><Icon name="shield" /></div><div><h3 className="font-semibold text-white">Privacy and permissions</h3><p className="mt-1 text-sm leading-6 text-[#777]">System changes run through the Electron main process. The React UI does not access Node.js, PowerShell, or the filesystem directly.</p></div></div></section>
    </div>
  );

  const renderActiveView = () => {
    if (activeTab === 'fortnite') return renderFortnite();
    if (activeTab === 'connection') return renderConnection();
    if (activeTab === 'settings') return renderSettings();
    return renderHome();
  };

  const logColor = (level) => ({ OK: 'text-emerald-300', INFO: 'text-[#a2a2a2]', ACTION: 'text-sky-300', WARN: 'text-amber-200', ERROR: 'text-rose-300', WAIT: 'text-[#777]' }[level] || 'text-[#a2a2a2]');
  const formatLogTime = (date) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date instanceof Date ? date : new Date(date));

  return (
    <div className="flex h-screen min-h-[720px] w-full overflow-hidden bg-black font-sans text-white selection:bg-white/20">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-white/5 bg-black px-6 py-7">
        <div className="flex items-center gap-4 px-2"><div className="grid h-12 w-12 place-items-center rounded-[15px] bg-white text-black"><Icon name="bolt" size={25} /></div><div><p className="text-xl font-bold tracking-[-0.04em]">BOOSTER</p><p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#666]">Performance console</p></div></div>

        <div className="mt-12 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5f5f5f]">Workspace</div>
        <nav className="relative mt-4 space-y-2" aria-label="Main navigation">
          <span className="pointer-events-none absolute left-0 top-0 h-[56px] w-full rounded-xl border border-white/5 bg-[#111] transition-transform duration-200 ease-out" style={{ transform: `translateY(${activeIndex * 64}px)` }} />
          {NAV_ITEMS.map((item, index) => {
            const active = activeTab === item.id;
            return <button type="button" key={item.id} onClick={() => setActiveTab(item.id)} className={`relative z-10 flex h-[56px] w-full items-center gap-4 rounded-xl px-4 text-left transition-colors duration-200 ease-out ${active ? 'text-white' : 'text-[#777] hover:text-white'}`}>
              <Icon name={item.icon} size={20} className={active ? 'text-white' : 'text-[#676767]'} /><span className="text-[15px] font-semibold">{item.label}</span>{active && <span className="ml-auto h-2 w-2 rounded-full bg-white" />}
            </button>;
          })}
        </nav>

        <div className="mt-auto space-y-5">
          <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.16em] text-[#777]">Booster status</span><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]" /></div><p className="mt-3 text-sm font-semibold text-white">Ready for your next session</p><p className="mt-1 text-xs leading-5 text-[#6f6f6f]">Actions are logged in the monitoring panel.</p></div>
          <button type="button" onClick={launchFortnite} className="group flex min-h-[76px] w-full items-center justify-between rounded-2xl bg-white px-5 text-black transition-all duration-200 hover:bg-[#dedede] active:scale-[0.99]"><span className="text-left"><span className="block text-[10px] font-bold tracking-[0.18em] text-black/55">READY WHEN YOU ARE</span><span className="mt-1 block text-lg font-extrabold tracking-[-0.02em]">LAUNCH FORTNITE</span></span><span className="grid h-11 w-11 place-items-center rounded-xl bg-black text-white transition-transform duration-200 group-hover:translate-x-1"><Icon name="arrow" size={19} /></span></button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-black px-8 py-7 2xl:px-10">
        <header className="mb-8 flex items-center justify-between border-b border-white/5 pb-6"><div><p className="text-sm font-medium text-[#6e6e6e]">Booster <span className="px-2 text-[#444]">/</span><span className="text-[#aaa]">{activeTitle}</span></p><h1 className="mt-3 text-[30px] font-semibold tracking-[-0.04em] text-white">{activeTitle === 'Overview' ? 'Your performance overview' : activeTitle}</h1></div><div className="flex items-center gap-3"><StatusPill tone={bridge ? 'green' : 'amber'}>{bridge ? 'MAIN PROCESS CONNECTED' : 'BRIDGE NOT CONNECTED'}</StatusPill><div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-[#111] text-sm font-bold text-white">B</div></div></header>
        <style>{'@keyframes booster-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}'}</style>
        <div key={activeTab} style={{ animation: 'booster-enter 200ms ease-out both' }}>{renderActiveView()}</div>
      </main>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/5 bg-[#050505]">
        <div className="flex items-center justify-between border-b border-white/5 px-7 py-7"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#666]">Monitoring</p><h2 className="mt-2 text-xl font-semibold tracking-tight text-white">Live system</h2></div><span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-30" /><span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" /></span></div>

        <div className="space-y-4 px-6 py-6">
          <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-white/[0.06] p-2 text-[#ccc]"><Icon name="cpu" size={17} /></div><span className="text-sm font-semibold text-[#aaa]">CPU utilization</span></div><div className="mt-5 flex items-end justify-between"><span className="text-3xl font-semibold tracking-[-0.04em] text-white">{metrics.cpu == null ? '—' : `${metrics.cpu}%`}</span><span className="text-xs text-[#666]">i5-8400 · 6 cores</span></div><div className="mt-4 h-1.5 rounded-full bg-[#222]"><div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${metrics.cpu == null ? 0 : Math.max(0, Math.min(100, metrics.cpu))}%` }} /></div></div>
          <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-white/[0.06] p-2 text-[#ccc]"><Icon name="signal" size={17} /></div><span className="text-sm font-semibold text-[#aaa]">GPU utilization</span></div><div className="mt-5 flex items-end justify-between"><span className="text-3xl font-semibold tracking-[-0.04em] text-white">{metrics.gpu == null ? '—' : `${metrics.gpu}%`}</span><span className="text-xs text-[#666]">GTX 1060 · 6 GB</span></div><div className="mt-4 h-1.5 rounded-full bg-[#222]"><div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${metrics.gpu == null ? 0 : Math.max(0, Math.min(100, metrics.gpu))}%` }} /></div></div>
          <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-white/[0.06] p-2 text-[#ccc]"><Icon name="memory" size={17} /></div><span className="text-sm font-semibold text-[#aaa]">System memory</span></div><div className="mt-5 flex items-end justify-between"><span className="text-3xl font-semibold tracking-[-0.04em] text-white">{metrics.memoryUsed == null ? '—' : `${metrics.memoryUsed} GB`}</span><span className="text-xs text-[#666]">of {metrics.memoryTotal} GB</span></div><div className="mt-4 h-1.5 rounded-full bg-[#222]"><div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${memoryPercent == null ? 0 : Math.max(0, Math.min(100, memoryPercent))}%` }} /></div></div>
          <div className="rounded-2xl border border-white/5 bg-[#0d0d0d] p-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-white/[0.06] p-2 text-[#ccc]"><Icon name="globe" size={17} /></div><span className="text-sm font-semibold text-[#aaa]">Network route</span></div><div className="mt-4 flex items-center justify-between"><span className="text-lg font-semibold text-white">{metrics.latency == null ? '— ms' : `${metrics.latency} ms`}</span><span className="text-xs text-[#666]">{metrics.adapter}</span></div><p className="mt-2 text-xs text-[#666]">Frankfurt target: 145 ms estimate</p></div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-white/5 px-6 py-6"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#666]">Activity stream</p><h3 className="mt-1 text-base font-semibold text-white">Diagnostic console</h3></div><button type="button" onClick={() => setLogs([])} className="rounded-lg border border-white/5 px-3 py-2 text-xs font-semibold text-[#777] transition-colors hover:bg-white/5 hover:text-white">CLEAR</button></div>
          <div className="min-h-[190px] flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/5 bg-black p-4 font-mono text-[12px] leading-5">
            {logs.map((entry) => <div key={entry.id} className="grid grid-cols-[60px_45px_1fr] gap-2"><span className="text-[#555]">{formatLogTime(entry.time)}</span><span className={`font-bold ${logColor(entry.level)}`}>{entry.level}</span><span className="break-words text-[#aaa]">{entry.message}</span></div>)}
            {logs.length === 0 && <p className="text-[#555]">No diagnostic activity.</p>}
            <div id="booster-console-end" />
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.13em] text-[#555]"><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Console active</span><span>{logs.length} entries</span></div>
        </div>
      </aside>

      {toast && <div role="status" className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-5 py-4 text-sm font-semibold shadow-2xl backdrop-blur ${toast.tone === 'green' ? 'border-emerald-300/20 bg-[#0d1712] text-emerald-100' : toast.tone === 'amber' ? 'border-amber-300/20 bg-[#19150c] text-amber-100' : 'border-white/10 bg-[#111] text-white'}`}>{toast.message}</div>}
    </div>
  );
}

export default App;
