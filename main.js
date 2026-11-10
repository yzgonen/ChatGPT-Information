'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const FORTNITE_PROTOCOL_URL = 'com.epicgames.launcher://apps%2FFortnite?action=launch&silent=true';
const FORTNITE_SETTINGS = {
  lobbyAnimations: { section: '/Script/FortniteGame.FortGameUserSettings', key: 'bShowLobbyBackground', enabled: 'False', disabled: 'True' },
  mobileRenderPathway: { section: '/Script/FortniteGame.FortGameUserSettings', key: 'D3DRHIPreference', enabled: 'ES31', disabled: 'Default' },
  grassRemoval: { section: '/Script/FortniteGame.FortGameUserSettings', key: 'bShowGrass', enabled: 'False', disabled: 'True' },
  foliageMotion: { section: 'ScalabilityGroups', key: 'sg.FoliageQuality', enabled: '0', disabled: '2' },
  mouseAcceleration: { section: '/Script/FortniteGame.FortGameUserSettings', key: 'bDisableMouseAcceleration', enabled: 'True', disabled: 'False' }
};
const NETWORK_OPTION_IDS = new Set([
  'tcpNoDelay', 'tcpAckFrequency', 'disableThrottling', 'flushDns', 'cloudflareDns', 'tcpAutoTuning'
]);

let mainWindow;
let optimizerInProgress = false;
let metricTimer;
let previousCpuSample;

function log(message, level = 'INFO') {
  const entry = { time: new Date().toISOString(), level, message: String(message) };
  console.log(`[${level}] ${entry.message}`);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('booster:log', entry);
}

function assertWindows() {
  if (process.platform !== 'win32') throw new Error('This action is available only on Windows.');
}

function assertTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Blocked an IPC request from an untrusted renderer.');
  }
}

async function runProcess(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    windowsHide: true,
    timeout: options.timeout ?? 30000,
    maxBuffer: 1024 * 1024,
    ...options
  });
  return (result.stdout || '').trim();
}

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  const sample = { idle, total };
  if (!previousCpuSample) {
    previousCpuSample = sample;
    return null;
  }
  const idleDelta = idle - previousCpuSample.idle;
  const totalDelta = total - previousCpuSample.total;
  previousCpuSample = sample;
  if (totalDelta <= 0) return null;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

async function readGpuUsage() {
  try {
    const value = await runProcess('nvidia-smi.exe', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 2500 });
    const number = Number.parseFloat(value.split(/\r?\n/)[0]);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  } catch {
    return null;
  }
}

async function publishHardwareMetrics() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  const payload = {
    cpu: cpuSnapshot(),
    gpu: await readGpuUsage(),
    memoryUsed: Number((usedMemory / (1024 ** 3)).toFixed(1)),
    memoryTotal: Number((totalMemory / (1024 ** 3)).toFixed(1)),
    latency: null,
    adapter: 'Game-server ping unavailable'
  };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('booster:hardware-metrics', payload);
}

async function purgeStandbyMemory() {
  assertWindows();
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class BoosterMemoryList {
    [DllImport("ntdll.dll")]
    private static extern int NtSetSystemInformation(int informationClass, ref int information, int informationLength);
    public static int PurgeStandbyList() {
        int command = 4;
        return NtSetSystemInformation(80, ref command, sizeof(int));
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
$status = [BoosterMemoryList]::PurgeStandbyList()
if ($status -ne 0) { throw ('Standby list purge failed with NTSTATUS 0x{0:X8}. Run Booster as Administrator.' -f $status) }
'Windows standby memory list purged.'
`;
  return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 30000 });
}

async function raiseDwmPriority() {
  assertWindows();
  // Keep the Windows desktop compositor alive. Force-terminating dwm.exe can blank the display.
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$processes = Get-Process -Name 'dwm' -ErrorAction Stop
foreach ($process in $processes) { $process.PriorityClass = 'High' }
'Raised priority for {0} DWM process(es).' -f $processes.Count
`;
  return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 15000 });
}

async function clearNvidiaShaderCache() {
  assertWindows();
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA is not set.');
  const canonicalLocalAppData = await fs.realpath(localAppData);
  const cacheRoot = path.resolve(localAppData, 'NVIDIA', 'DXCache');
  const expectedNvidiaDirectory = path.resolve(canonicalLocalAppData, 'NVIDIA');
  const actualNvidiaDirectory = await fs.realpath(path.dirname(cacheRoot)).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (actualNvidiaDirectory && actualNvidiaDirectory.toLowerCase() !== expectedNvidiaDirectory.toLowerCase()) {
    throw new Error('Refusing to clear a cache path outside the local NVIDIA directory.');
  }
  let root;
  try {
    root = await fs.lstat(cacheRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return { deletedFiles: 0, skippedFiles: 0, message: 'NVIDIA DXCache was not found.' };
    throw error;
  }
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('NVIDIA DXCache is not a regular directory.');

  let deletedFiles = 0;
  let skippedFiles = 0;
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skippedFiles += 1; continue; }
      if (entry.isDirectory()) { await visit(entryPath); continue; }
      if (!entry.isFile()) { skippedFiles += 1; continue; }
      try {
        await fs.unlink(entryPath);
        deletedFiles += 1;
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        if (['EBUSY', 'EACCES', 'EPERM', 'UNKNOWN'].includes(error.code)) { skippedFiles += 1; continue; }
        throw error;
      }
    }
  };
  await visit(cacheRoot);
  return { deletedFiles, skippedFiles, message: 'NVIDIA cache files removed; the driver will recreate them as needed.' };
}

async function optimizeCpuPowerPlan() {
  assertWindows();
  const query = await runProcess('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_PROCESSOR'], { timeout: 15000 });
  const active = await runProcess('powercfg.exe', ['/getactivescheme'], { timeout: 10000 });
  const activeGuid = active.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0];
  if (!activeGuid) throw new Error('Could not identify the active Windows power plan.');
  const settings = {};
  for (const alias of ['CPMINCORES', 'PROCTHROTTLEMIN']) {
    const section = await runProcess('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_PROCESSOR', alias], { timeout: 10000 });
    const values = [...section.matchAll(/Current\s+(AC|DC)\s+Power\s+Setting\s+Index:\s+0x([0-9a-f]+)/gi)];
    if (!values.length) throw new Error(`Could not read the current ${alias} power settings; no changes were made.`);
    settings[alias] = Object.fromEntries(values.map((match) => [match[1].toLowerCase(), parseInt(match[2], 16)]));
  }
  const backupDirectory = path.join(app.getPath('userData'), 'backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `cpu-power-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(backupPath, JSON.stringify({ createdUtc: new Date().toISOString(), activeGuid, settings }, null, 2), { flag: 'wx' });
  try {
    for (const [alias, value] of [['CPMINCORES', 100], ['PROCTHROTTLEMIN', 100]]) {
      await runProcess('powercfg.exe', ['/setacvalueindex', activeGuid, 'SUB_PROCESSOR', alias, String(value)], { timeout: 10000 });
      await runProcess('powercfg.exe', ['/setdcvalueindex', activeGuid, 'SUB_PROCESSOR', alias, String(value)], { timeout: 10000 });
    }
    await runProcess('powercfg.exe', ['/setactive', activeGuid], { timeout: 10000 });
  } catch (error) {
    log(`CPU power plan update failed. Previous settings are recorded at ${backupPath}.`, 'WARN');
    throw error;
  }
  return { backupPath, activeGuid, message: 'Core parking disabled and minimum processor performance set to 100% for AC and DC power.' };
}

async function auditBackgroundMemory() {
  assertWindows();
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$excluded = @('System','Idle','Registry','Memory Compression','csrss','wininit','services','lsass','svchost','dwm','explorer','FortniteClient-Win64-Shipping','EpicGamesLauncher')
$items = Get-Process | Where-Object { $_.WorkingSet64 -ge 150MB -and $_.MainWindowHandle -eq 0 -and $excluded -notcontains $_.ProcessName } | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 ProcessName,Id,@{Name='MemoryMB';Expression={[math]::Round($_.WorkingSet64 / 1MB)}}
@($items) | ConvertTo-Json -Depth 3 -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 20000 });
  let processes = [];
  try { processes = output ? JSON.parse(output) : []; } catch { throw new Error('Background memory scan returned invalid data.'); }
  if (!Array.isArray(processes)) processes = processes ? [processes] : [];
  return { scanned: true, processes, message: 'Listed large background memory users for review. Booster leaves other apps and browser update services running to protect open work and security updates.' };
}

function decodeIni(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: Buffer.from([0xff, 0xfe]) };
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    return { text: swapped.toString('utf16le'), encoding: 'utf16le', bom: Buffer.from([0xfe, 0xff]), bigEndian: true };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf8', bom: Buffer.from([0xef, 0xbb, 0xbf]) };
  return { text: buffer.toString('utf8'), encoding: 'utf8', bom: Buffer.alloc(0) };
}

function encodeIni(text, format) {
  let body = Buffer.from(text, format.encoding);
  if (format.bigEndian) {
    body = Buffer.from(body);
    for (let i = 0; i + 1 < body.length; i += 2) [body[i], body[i + 1]] = [body[i + 1], body[i]];
  }
  return Buffer.concat([format.bom, body]);
}

function setIniValue(text, sectionName, key, value) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const sectionHeader = `[${sectionName}]`;
  let start = lines.findIndex((line) => line.trim().toLowerCase() === sectionHeader.toLowerCase());
  if (start === -1) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(sectionHeader);
    start = lines.length - 1;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) { end = i; break; }
  }
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`^\\s*${escapedKey}\\s*=`, 'i');
  for (let i = start + 1; i < end; i += 1) {
    if (keyPattern.test(lines[i])) { lines[i] = `${key}=${value}`; return lines.join(newline); }
  }
  lines.splice(end, 0, `${key}=${value}`);
  return lines.join(newline);
}

async function updateFortniteSettings(flags) {
  assertWindows();
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new TypeError('Fortnite settings must be an object.');
  for (const key of Object.keys(flags)) {
    if (!Object.hasOwn(FORTNITE_SETTINGS, key) || typeof flags[key] !== 'boolean') throw new Error(`Unsupported Fortnite profile flag: ${key}`);
  }
  const changes = Object.entries(flags).map(([flag, enabled]) => {
    const item = FORTNITE_SETTINGS[flag];
    return [item.section, item.key, enabled ? item.enabled : item.disabled];
  });
  if (!changes.length) return { changed: false, message: 'No profile settings were selected.' };

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA is not set.');
  const configPath = path.resolve(localAppData, 'FortniteGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini');
  const expectedParent = path.resolve(await fs.realpath(localAppData), 'FortniteGame', 'Saved', 'Config', 'WindowsClient');
  const actualParent = await fs.realpath(path.dirname(configPath));
  if (actualParent.toLowerCase() !== expectedParent.toLowerCase()) throw new Error('Refusing to write outside the Fortnite settings folder.');
  const stat = await fs.lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Fortnite settings path is not a regular file.');

  const original = await fs.readFile(configPath);
  const format = decodeIni(original);
  let updatedText = format.text;
  for (const [section, key, value] of changes) updatedText = setIniValue(updatedText, section, key, value);
  const updated = encodeIni(updatedText, format);
  if (original.equals(updated)) return { changed: false, message: 'The selected settings already match the file.' };

  const backupPath = `${configPath}.bak`;
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    const backupStat = await fs.lstat(backupPath);
    if (!backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error('The Fortnite backup path is not a regular file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.copyFile(configPath, backupPath);
  const wasReadOnly = (stat.mode & 0o200) === 0;
  try {
    if (wasReadOnly) await fs.chmod(configPath, stat.mode | 0o200);
    await fs.writeFile(temporaryPath, updated, { flag: 'wx', mode: stat.mode });
    if (wasReadOnly) await fs.chmod(temporaryPath, stat.mode & ~0o200);
    await fs.rename(temporaryPath, configPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    if (wasReadOnly) await fs.chmod(configPath, stat.mode).catch(() => {});
    throw error;
  }
  return { changed: true, backupPath, readOnlyRestored: wasReadOnly, settingsChanged: changes.map(([, key]) => key) };
}

async function runNetworkOptimization(request) {
  assertWindows();
  const selected = request?.options;
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== 'string' || !NETWORK_OPTION_IDS.has(id))) {
    throw new TypeError('Network options contain an unsupported setting.');
  }
  if (selected.length === 0) return { ok: true, results: [] };
  const encodedOptions = Buffer.from(JSON.stringify([...new Set(selected)]), 'utf8').toString('base64');
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$selected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedOptions}')) | ConvertFrom-Json
$local = $env:LOCALAPPDATA
$backupDirectory = Join-Path $local 'Booster\backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$adapter = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | Sort-Object -Property LinkSpeed -Descending | Select-Object -First 1
if (-not $adapter) { throw 'No active physical network adapter was found.' }
$interfaceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($adapter.InterfaceGuid)"
$profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile'
$backup = [ordered]@{ createdUtc = [DateTime]::UtcNow.ToString('o'); adapterName = $adapter.Name; interfaceGuid = $adapter.InterfaceGuid; dns = @((Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4).ServerAddresses); registry = @{} }
foreach ($pair in @(@($interfaceKey, 'TcpNoDelay'), @($interfaceKey, 'TcpAckFrequency'), @($profileKey, 'NetworkThrottlingIndex'))) {
  $registryPath = $pair[0]; $propertyName = $pair[1]
  $value = 0
  $key = Get-ItemProperty -LiteralPath $registryPath -Name $propertyName -ErrorAction SilentlyContinue
  if ($key -and $null -ne $key.$propertyName) { $value = $key.$propertyName }
  $backup.registry["$registryPath|$propertyName"] = $value
}
$backupPath = Join-Path $backupDirectory ('network-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$backup | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $backupPath -Encoding utf8
$results = [System.Collections.Generic.List[object]]::new()
foreach ($option in $selected) {
  try {
    switch ($option) {
      'tcpNoDelay' { New-ItemProperty -LiteralPath $interfaceKey -Name 'TcpNoDelay' -PropertyType DWord -Value 1 -Force | Out-Null; $results.Add(@{name=$option;ok=$true;message='TCPNoDelay set for the active adapter.'}) }
      'tcpAckFrequency' { New-ItemProperty -LiteralPath $interfaceKey -Name 'TcpAckFrequency' -PropertyType DWord -Value 1 -Force | Out-Null; $results.Add(@{name=$option;ok=$true;message='TCPAckFrequency set for the active adapter.'}) }
      'disableThrottling' { New-ItemProperty -LiteralPath $profileKey -Name 'NetworkThrottlingIndex' -PropertyType DWord -Value ([int]-1) -Force | Out-Null; $results.Add(@{name=$option;ok=$true;message='NetworkThrottlingIndex set to 0xffffffff.'}) }
      'flushDns' { Clear-DnsClientCache; $results.Add(@{name=$option;ok=$true;message='DNS resolver cache flushed.'}) }
      'cloudflareDns' { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @('1.1.1.1','1.0.0.1'); $results.Add(@{name=$option;ok=$true;message='Cloudflare DNS set on the active adapter.'}) }
      'tcpAutoTuning' { $output = & netsh.exe int tcp set global autotuninglevel=normal 2>&1; if ($LASTEXITCODE -ne 0) { throw ($output -join ' ') }; $results.Add(@{name=$option;ok=$true;message='TCP auto-tuning set to normal.'}) }
    }
  } catch { $results.Add(@{name=$option;ok=$false;message=$_.Exception.Message}) }
}
@{ok=($results.Where({ -not $_.ok }).Count -eq 0);backupPath=$backupPath;adapter=$adapter.Name;results=@($results)} | ConvertTo-Json -Depth 7 -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 45000 });
  const jsonLine = output.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).at(-1);
  if (!jsonLine) throw new Error(output || 'Windows network script returned no result.');
  const result = JSON.parse(jsonLine);
  log(`Network update ran on ${result.adapter}; backup saved at ${result.backupPath}.`, result.ok ? 'OK' : 'WARN');
  return result;
}

async function launchFortnite() {
  assertWindows();
  await shell.openExternal(FORTNITE_PROTOCOL_URL);
  log('Epic Games Fortnite launch protocol handed to Windows.', 'OK');
  return { launched: true };
}

async function runOptimizer() {
  assertWindows();
  if (optimizerInProgress) throw new Error('The optimizer is already running.');
  optimizerInProgress = true;
  log('Starting one-click system maintenance.', 'ACTION');
  const results = [];
  try {
    for (const [name, action] of [
      ['Standby memory', purgeStandbyMemory],
      ['CPU power plan', optimizeCpuPowerPlan],
      ['Background memory scan', auditBackgroundMemory],
      ['Desktop Window Manager priority', raiseDwmPriority],
      ['NVIDIA shader cache', clearNvidiaShaderCache]
    ]) {
      try {
        const details = await action();
        results.push({ name, ok: true, details });
        log(`${name}: ${typeof details === 'string' ? details : JSON.stringify(details)}`, 'OK');
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
        log(`${name}: ${error.message}`, 'WARN');
      }
    }
    return { ok: results.every((result) => result.ok), results };
  } finally {
    optimizerInProgress = false;
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    try { return await handler(...args); }
    catch (error) { log(error.message, 'ERROR'); throw error; }
  });
}

function registerIpcHandlers() {
  handle('booster:launch-fortnite', launchFortnite);
  handle('booster:run-optimizer', runOptimizer);
  handle('booster:update-fortnite-settings', updateFortniteSettings);
  handle('booster:run-network-optimization', runNetworkOptimization);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    maxWidth: 1200,
    maxHeight: 800,
    resizable: false,
    fullscreenable: false,
    center: true,
    title: 'Booster',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAllowed = app.isPackaged ? url.startsWith('file:') : url.startsWith('http://127.0.0.1:5173/');
    if (!isAllowed) event.preventDefault();
  });
  if (app.isPackaged) mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  else mainWindow.loadURL('http://127.0.0.1:5173');
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.booster.desktop');
  registerIpcHandlers();
  createWindow();
  publishHardwareMetrics();
  metricTimer = setInterval(publishHardwareMetrics, 2500);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('Booster failed to start:', error);
  app.quit();
});

app.on('before-quit', () => { if (metricTimer) clearInterval(metricTimer); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
