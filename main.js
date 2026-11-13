'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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
const WINDOWS_TWEAK_IDS = new Set(['win32PriorityThreads', 'disableGameDvr']);
const WINUTIL_GAMING_PROFILE = Object.freeze([
  'WPFTweaksRestorePoint',
  'WPFToggleGameMode',
  'WPFTweaksDisplay'
]);

let mainWindow;
let optimizerInProgress = false;
let metricTimer;
let previousCpuSample;
const cleanupCandidates = new Map();

const CLEANUP_PROTECTED_DIRECTORIES = new Set([
  '$RECYCLE.BIN', 'SYSTEM VOLUME INFORMATION', 'WINDOWS', 'PROGRAM FILES',
  'PROGRAM FILES (X86)', 'RECOVERY', 'CONFIG.MSI',
  'WINDOWSAPPS', 'XBOXGAMES', 'STEAMLIBRARY', 'STEAM', 'EPIC GAMES',
  'EPICGAMES', 'FORTNITE', 'FORTNITEGAME', 'RIOT GAMES', 'BATTLE.NET',
  'UBISOFT GAME LAUNCHER', 'GOG GAMES', 'ORIGIN GAMES', 'GAMES',
  'GAME LIBRARY', 'GAME LIBRARIES', 'GAMES LIBRARY', 'GAMESLIBRARY',
  'APPLICATIONS', 'PROGRAMS'
]);
const CLEANUP_PROTECTED_EXTENSIONS = new Set([
  '.exe', '.dll', '.sys', '.drv', '.ocx', '.msi', '.msp', '.msix', '.appx',
  '.bat', '.cmd', '.ps1', '.vbs', '.com', '.scr', '.reg', '.lnk'
]);
const CLEANUP_TEMP_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CLEANUP_LARGE_FILE_MIN_BYTES = 100 * 1024 * 1024;
const CLEANUP_MAX_VISITED_FILES = 150000;
const CLEANUP_MAX_RETURNED_ITEMS = 300;
const REGION_PROBE_HOSTS = Object.freeze({
  'eu-central': 'ec2.eu-central-1.amazonaws.com',
  'eu-west': 'ec2.eu-west-1.amazonaws.com',
  'na-east': 'ec2.us-east-1.amazonaws.com',
  'na-central': 'ec2.us-east-2.amazonaws.com',
  'na-west': 'ec2.us-west-2.amazonaws.com',
  brazil: 'ec2.sa-east-1.amazonaws.com',
  asia: 'ec2.ap-northeast-1.amazonaws.com',
  oceania: 'ec2.ap-southeast-2.amazonaws.com',
  'middle-east': 'ec2.me-south-1.amazonaws.com',
  'south-africa': 'ec2.af-south-1.amazonaws.com'
});

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

async function optimizeCpuPowerPlan() {
  assertWindows();
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
  log(`Background memory scan returned ${processes.length} candidate process(es).`, 'INFO');
  return { scanned: true, processes, message: 'Listed large background memory users for review. Booster leaves other apps and browser update services running to protect open work and security updates.' };
}

async function scanController() {
  assertWindows();
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$devices = @(Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in @('HIDClass','USB') -and $_.FriendlyName -match 'controller|dualshock|wireless controller|playstation' } | Select-Object @{Name='name';Expression={$_.FriendlyName}},@{Name='status';Expression={$_.Status}},@{Name='class';Expression={$_.Class}},@{Name='instanceId';Expression={$_.InstanceId}})
@{devices=$devices;scannedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 4 -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 20000 });
  const line = output.split(/\r?\n/).filter((item) => item.trim().startsWith('{')).at(-1);
  if (!line) throw new Error(output || 'Controller scan returned no result.');
  const result = JSON.parse(line);
  if (!Array.isArray(result.devices)) result.devices = result.devices ? [result.devices] : [];
  return result;
}

async function getServiceStatus() {
  assertWindows();
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$services = @(Get-CimInstance Win32_Service -Filter "Name='DiagTrack' OR Name='WerSvc' OR Name='SysMain' OR Name='wuauserv' OR Name='WbioSrvc'" | Select-Object @{Name='name';Expression={$_.Name}},@{Name='displayName';Expression={$_.DisplayName}},@{Name='status';Expression={$_.State}},@{Name='startMode';Expression={$_.StartMode}})
@{services=$services;scannedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 4 -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 20000 });
  const line = output.split(/\r?\n/).filter((item) => item.trim().startsWith('{')).at(-1);
  if (!line) throw new Error(output || 'Service status scan returned no result.');
  const result = JSON.parse(line);
  if (!Array.isArray(result.services)) result.services = result.services ? [result.services] : [];
  return result;
}

async function measureNetworkQuality() {
  assertWindows();
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
function Measure-Target([string]$Target) {
  $replies = @(Test-Connection -ComputerName $Target -Count 5 -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.ResponseTime })
  $loss = [math]::Round((5 - $replies.Count) * 20, 1)
  $average = $null; $jitter = $null
  if ($replies.Count -gt 0) { $average = [math]::Round(($replies | Measure-Object -Average).Average, 1) }
  if ($replies.Count -gt 1) {
    $differences = for ($i = 1; $i -lt $replies.Count; $i++) { [math]::Abs($replies[$i] - $replies[$i - 1]) }
    $jitter = [math]::Round(($differences | Measure-Object -Average).Average, 1)
  }
  return @{target=$Target;sent=5;received=$replies.Count;lossPercent=$loss;averageMs=$average;jitterMs=$jitter}
}
$gateway = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1 -ExpandProperty NextHop
$gatewayResult = if ($gateway -and $gateway -ne '0.0.0.0') { Measure-Target $gateway } else { @{target='Default gateway unavailable';sent=0;received=0;lossPercent=$null;averageMs=$null;jitterMs=$null} }
$internetResult = Measure-Target '1.1.1.1'
@{gateway=$gatewayResult;internet=$internetResult;measuredUtc=[DateTime]::UtcNow.ToString('o');note='ICMP samples; not game-server latency.'} | ConvertTo-Json -Depth 5 -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 30000 });
  const line = output.split(/\r?\n/).filter((item) => item.trim().startsWith('{')).at(-1);
  if (!line) throw new Error(output || 'Network sample returned no result.');
  return JSON.parse(line);
}

async function openSoundSettings() {
  assertWindows();
  await shell.openExternal('ms-settings:sound');
  return { opened: true };
}

async function openMouseSettings() {
  assertWindows();
  await shell.openExternal('ms-settings:mousetouchpad');
  return { opened: true };
}

async function openEpicLauncher() {
  assertWindows();
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Epic Games', 'Launcher', 'EpicGamesLauncher.exe')
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        const error = await shell.openPath(candidate);
        if (error) throw new Error(error);
        return { opened: true, path: candidate };
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !String(error.message).includes('The system cannot find')) throw error;
    }
  }
  throw new Error('Epic Games Launcher was not found in its standard install locations. Open it from the Start menu, then use Library → Fortnite → Manage → Verify.');
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  if (!relative) return true;
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function hasProtectedDirectorySegment(candidatePath) {
  return path.resolve(candidatePath).split(path.sep).some((segment) => CLEANUP_PROTECTED_DIRECTORIES.has(segment.trim().toUpperCase()));
}

function isProtectedCleanupFile(candidatePath) {
  return hasProtectedDirectorySegment(candidatePath) || CLEANUP_PROTECTED_EXTENSIONS.has(path.extname(candidatePath).toLowerCase());
}

async function getStorageOverview() {
  assertWindows();
  const drives = [];
  for (const letter of ['C', 'D']) {
    const root = `${letter}:\\`;
    try {
      const stats = await fs.statfs(root);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      drives.push({ letter, root, available: true, totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) });
    } catch (error) {
      if (letter === 'C') throw new Error(`Could not read the C: drive: ${error.message}`);
      drives.push({ letter, root, available: false, totalBytes: 0, freeBytes: 0, usedBytes: 0 });
    }
  }
  return { drives };
}

async function scanDriveCleanup(letter) {
  assertWindows();
  const driveLetter = String(letter || '').toUpperCase();
  if (!['C', 'D'].includes(driveLetter)) throw new TypeError('Only the C: and D: drives can be scanned.');
  const driveRoot = `${driveLetter}:\\`;
  const driveInfo = await fs.statfs(driveRoot).catch((error) => {
    throw new Error(`The ${driveLetter}: drive is unavailable: ${error.message}`);
  });
  const driveTotalBytes = Number(driveInfo.blocks) * Number(driveInfo.bsize);
  const driveFreeBytes = Number(driveInfo.bavail) * Number(driveInfo.bsize);
  const scanRoots = [];
  const addRoot = async (rootPath, kind, label) => {
    if (!rootPath) return;
    const resolved = path.resolve(rootPath);
    const isInstalledProgramInventoryRoot = kind === 'inventory'
      && ['PROGRAM FILES', 'PROGRAM FILES (X86)', 'PROGRAMS'].includes(path.basename(resolved).trim().toUpperCase());
    if (!isPathInside(driveRoot, resolved) || (isProtectedCleanupFile(resolved) && !isInstalledProgramInventoryRoot)) return;
    const stat = await fs.lstat(resolved).catch(() => null);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return;
    const canonical = await fs.realpath(resolved).catch(() => null);
    if (!canonical || !isPathInside(driveRoot, canonical) || (isProtectedCleanupFile(canonical) && !isInstalledProgramInventoryRoot)) return;
    if (scanRoots.some((root) => isPathInside(root.path, canonical))) return;
    scanRoots.push({ path: canonical, kind, label, inventoryOnly: isInstalledProgramInventoryRoot, maxDepth: isInstalledProgramInventoryRoot ? 8 : 12 });
  };

  if (driveLetter === 'C') {
    const localAppData = process.env.LOCALAPPDATA;
    const roamingAppData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;
    await addRoot(localAppData ? path.join(localAppData, 'Temp') : process.env.TEMP, 'temporary', 'User temporary files');
    if (userProfile) {
      for (const folder of ['Downloads', 'Desktop', 'Documents', 'Videos', 'Pictures', 'Music', 'Saved Games']) {
        await addRoot(path.join(userProfile, folder), 'review', folder);
      }
    }
    await addRoot(localAppData, 'review', 'Local AppData and application caches');
    await addRoot(roamingAppData, 'review', 'Roaming AppData and application data');
    await addRoot(process.env.ProgramData, 'review', 'ProgramData application data');
    await addRoot(path.join(localAppData || '', 'Programs'), 'inventory', 'Installed applications (Local AppData)');
    await addRoot(path.join(driveRoot, 'Program Files'), 'inventory', 'Installed applications (Program Files)');
    await addRoot(path.join(driveRoot, 'Program Files (x86)'), 'inventory', 'Installed applications (Program Files x86)');
  } else {
    scanRoots.push({ path: path.resolve(driveRoot), kind: 'review', label: 'D: root files', filesOnly: true });
    const entries = await fs.readdir(driveRoot, { withFileTypes: true }).catch((error) => {
      throw new Error(`Could not list the D: drive: ${error.message}`);
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') || CLEANUP_PROTECTED_DIRECTORIES.has(entry.name.trim().toUpperCase())) continue;
      await addRoot(path.join(driveRoot, entry.name), 'review', entry.name);
    }
    await addRoot(path.join(driveRoot, 'Temp'), 'temporary', 'D: temporary files');
  }

  const now = Date.now();
  const tempCutoff = now - CLEANUP_TEMP_MIN_AGE_MS;
  const candidates = [];
  const seen = new Set();
  const folderSizes = new Map();
  let visitedFiles = 0;
  let skippedFiles = 0;
  let candidateBytes = 0;
  let temporaryBytes = 0;
  let reviewBytes = 0;
  let truncated = false;
  let lastProgressAt = 0;

  function publishStorageProgress(currentDirectory) {
    const nowProgress = Date.now();
    if (nowProgress - lastProgressAt < 350) return;
    lastProgressAt = nowProgress;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('booster:storage-progress', {
        drive: driveLetter,
        scannedFiles: visitedFiles,
        candidates: candidates.length,
        currentDirectory: String(currentDirectory).slice(0, 240)
      });
    }
  }

  function accountFolderSize(filePath, root, bytes) {
    let directory = path.dirname(filePath);
    let levels = 0;
    while (isPathInside(root.path, directory) && levels <= 8) {
      const relative = path.relative(root.path, directory);
      const depth = relative ? relative.split(path.sep).filter(Boolean).length : 0;
      if (depth <= 4) {
        const key = root.path.toLowerCase() + '|' + directory.toLowerCase();
        const current = folderSizes.get(key) || { path: directory, source: root.label, bytes: 0, files: 0, depth };
        current.bytes += bytes;
        current.files += 1;
        folderSizes.set(key, current);
      }
      if (path.resolve(directory).toLowerCase() === path.resolve(root.path).toLowerCase()) break;
      directory = path.dirname(directory);
      levels += 1;
    }
  }

  async function walk(directory, root, depth) {
    if (visitedFiles >= CLEANUP_MAX_VISITED_FILES) { truncated = true; return; }
    const relativeDirectory = path.relative(root.path, directory);
    const protectedInventoryChild = root.inventoryOnly && relativeDirectory
      ? relativeDirectory.split(path.sep).some((segment) => CLEANUP_PROTECTED_DIRECTORIES.has(segment.trim().toUpperCase()))
      : false;
    if (depth > root.maxDepth || protectedInventoryChild || (!root.inventoryOnly && hasProtectedDirectorySegment(directory))) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => { skippedFiles += 1; return []; });
    for (const entry of entries) {
      if (visitedFiles >= CLEANUP_MAX_VISITED_FILES) { truncated = true; return; }
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || entry.name.startsWith('$')) { skippedFiles += 1; continue; }
      if (entry.isDirectory()) {
        if (root.filesOnly) continue;
        if (CLEANUP_PROTECTED_DIRECTORIES.has(entry.name.trim().toUpperCase())) continue;
        await walk(fullPath, root, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      visitedFiles += 1;
      if (visitedFiles % 250 === 0) publishStorageProgress(directory);
      const stat = await fs.lstat(fullPath).catch(() => null);
      if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) { skippedFiles += 1; continue; }
      accountFolderSize(fullPath, root, stat.size);
      if (root.inventoryOnly || isProtectedCleanupFile(fullPath)) continue;
      const isOldTemporary = root.kind === 'temporary' && stat.mtimeMs <= tempCutoff;
      const isLargeReviewFile = root.kind === 'review' && stat.size >= CLEANUP_LARGE_FILE_MIN_BYTES;
      if (!isOldTemporary && !isLargeReviewFile) continue;
      const canonicalPath = await fs.realpath(fullPath).catch(() => null);
      if (!canonicalPath || !isPathInside(root.path, canonicalPath) || isProtectedCleanupFile(canonicalPath)) { skippedFiles += 1; continue; }
      const identity = canonicalPath.toLowerCase();
      if (seen.has(identity)) continue;
      seen.add(identity);
      const id = randomUUID();
      const candidate = {
        id,
        name: path.basename(canonicalPath),
        path: canonicalPath,
        bytes: stat.size,
        modifiedUtc: stat.mtime.toISOString(),
        accessedUtc: stat.atime.toISOString(),
        category: isOldTemporary ? 'temporary' : 'review',
        source: root.label,
        allowedRoot: root.path,
        safeToDelete: isOldTemporary,
        note: isOldTemporary ? 'Temporary file older than 14 days; selected files go to the Recycle Bin.' : 'Large personal-data candidate. Review its full path and name before selecting it.'
      };
      candidates.push(candidate);
      candidateBytes += stat.size;
      if (isOldTemporary) temporaryBytes += stat.size;
      else reviewBytes += stat.size;
    }
  }

  log(`Storage scan ${driveLetter}: started across ${scanRoots.length} selected folder tree(s); system and installed game folders are excluded.`, 'ACTION');
  for (const root of scanRoots) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('booster:storage-progress', { drive: driveLetter, scannedFiles: visitedFiles, candidates: candidates.length, currentDirectory: root.label });
    await walk(root.path, root, 0);
  }
  candidates.sort((left, right) => right.bytes - left.bytes);
  const folders = [...folderSizes.values()]
    .filter((folder) => folder.bytes >= 256 * 1024 * 1024)
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 50);
  const returned = candidates.slice(0, CLEANUP_MAX_RETURNED_ITEMS);
  const returnedIds = new Set(returned.map((candidate) => candidate.id));
  for (const candidate of candidates) {
    if (!returnedIds.has(candidate.id)) continue;
    cleanupCandidates.set(candidate.id, {
      ...candidate,
      expiresAt: now + 15 * 60 * 1000
    });
  }
  for (const [id, candidate] of cleanupCandidates) if (candidate.expiresAt < now) cleanupCandidates.delete(id);

  return {
    drive: driveLetter,
    totalBytes: driveTotalBytes,
    freeBytes: driveFreeBytes,
    scannedFiles: visitedFiles,
    skippedItems: skippedFiles,
    candidateCount: candidates.length,
    candidateBytes,
    temporaryBytes,
    reviewBytes,
    items: returned.map(({ id, name, path: candidatePath, bytes, modifiedUtc, accessedUtc, category, source, safeToDelete, note }) => ({ id, name, path: candidatePath, bytes, modifiedUtc, accessedUtc, category, source, safeToDelete, note })),
    folders: folders.map(({ path: folderPath, source, bytes, files, depth }) => ({ path: folderPath, source, bytes, files, depth })),
    truncated,
    message: driveLetter === 'C'
      ? 'C: scan checks user files, Local/Roaming AppData, ProgramData, and installed application folders. Installed applications are inventory-only; only old Temp files are marked safe to delete.'
      : 'D: scan checks files at the drive root and ordinary top-level folders. Known system and game-library folders are excluded; large files are review-only.'
  };
}

async function measureRegion(request) {
  assertWindows();
  const region = String(request?.region || '');
  const host = REGION_PROBE_HOSTS[region];
  if (!host) throw new TypeError('Select a supported region probe.');
  const encoded = Buffer.from(JSON.stringify({ region, host }), 'utf8').toString('base64');
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$times = @(Test-Connection -ComputerName $target.host -Count 5 -ErrorAction SilentlyContinue | ForEach-Object { [double]$_.ResponseTime })
$loss = [math]::Round((5 - $times.Count) * 20, 1)
$average = $null; $jitter = $null
if ($times.Count -gt 0) { $average = [math]::Round(($times | Measure-Object -Average).Average, 1) }
if ($times.Count -gt 1) { $differences = for ($i=1; $i -lt $times.Count; $i++) { [math]::Abs($times[$i] - $times[$i-1]) }; $jitter = [math]::Round(($differences | Measure-Object -Average).Average, 1) }
@{region=$target.region;host=$target.host;sent=5;received=$times.Count;lossPercent=$loss;averageMs=$average;jitterMs=$jitter;measuredUtc=[DateTime]::UtcNow.ToString('o');note='Regional cloud ICMP probe, not a Fortnite or Minecraft server measurement.'} | ConvertTo-Json -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 20000 });
  const line = output.split(/\r?\n/).filter((item) => item.trim().startsWith('{')).at(-1);
  if (!line) throw new Error(output || 'Regional network probe returned no result.');
  const result = JSON.parse(line);
  log(`${result.region} regional probe: ${result.averageMs == null ? 'no ICMP reply' : `${result.averageMs} ms`} average; ${result.lossPercent}% loss. This is not the game server route.`, result.received ? 'INFO' : 'WARN');
  return result;
}

async function moveCleanupCandidatesToRecycleBin(request) {
  assertWindows();
  const ids = request?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== 'string')) {
    throw new TypeError('Select between 1 and 100 scan results to move to the Recycle Bin.');
  }
  const uniqueIds = [...new Set(ids)];
  const selected = uniqueIds.map((id) => cleanupCandidates.get(id)).filter(Boolean);
  if (selected.length !== uniqueIds.length) throw new Error('The scan results expired or changed. Scan the drive again before deleting.');
  const totalBytes = selected.reduce((total, item) => total + item.bytes, 0);
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Review selected files',
    message: `Move ${selected.length} selected file(s) to the Recycle Bin?`,
    detail: `${(totalBytes / (1024 ** 3)).toFixed(2)} GB selected. Files are not permanently erased. Review every path in the list before continuing.`,
    buttons: ['Cancel', 'Move to Recycle Bin'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (response.response !== 1) return { cancelled: true, deletedCount: 0, results: [] };

  const results = [];
  for (const candidate of selected) {
    try {
      if (candidate.expiresAt < Date.now() || !candidate.allowedRoot || isProtectedCleanupFile(candidate.path) || !isPathInside(candidate.allowedRoot, candidate.path)) {
        throw new Error('This path is protected or the scan result expired.');
      }
      const stat = await fs.lstat(candidate.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== candidate.bytes || stat.mtime.toISOString() !== candidate.modifiedUtc) {
        throw new Error('The file changed since the scan. Scan again before moving it.');
      }
      const canonicalPath = await fs.realpath(candidate.path);
      if (!isPathInside(candidate.allowedRoot, canonicalPath) || canonicalPath.toLowerCase() !== candidate.path.toLowerCase()) {
        throw new Error('The file path changed or resolves outside the scanned folder.');
      }
      await shell.trashItem(canonicalPath);
      cleanupCandidates.delete(candidate.id);
      results.push({ id: candidate.id, ok: true, name: candidate.name, bytes: candidate.bytes, message: 'Moved to Recycle Bin.' });
    } catch (error) {
      results.push({ id: candidate.id, ok: false, name: candidate.name, bytes: candidate.bytes, message: error.message });
    }
  }
  const deletedCount = results.filter((item) => item.ok).length;
  log(`Storage cleanup moved ${deletedCount} of ${selected.length} selected file(s) to the Recycle Bin.`, deletedCount === selected.length ? 'OK' : 'WARN');
  return { cancelled: false, deletedCount, results };
}

async function applyWindowsTweaks(flags) {
  assertWindows();
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new TypeError('Windows system options must be an object.');
  for (const [key, value] of Object.entries(flags)) {
    if (!WINDOWS_TWEAK_IDS.has(key) || typeof value !== 'boolean') throw new Error(`Unsupported Windows system option: ${key}`);
  }
  if (!Object.keys(flags).length) return { ok: true, results: [], message: 'No Windows system options were selected.' };
  const encodedFlags = Buffer.from(JSON.stringify(flags), 'utf8').toString('base64');
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$flags = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedFlags}')) | ConvertFrom-Json
$local = $env:LOCALAPPDATA
$backupDirectory = Join-Path $local 'Booster\backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$targets = @(
  @{ id='win32PriorityThreads'; path='HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl'; name='Win32PrioritySeparation'; enabled=0x26; disabled=2 },
  @{ id='disableGameDvr'; path='HKCU:\System\GameConfigStore'; name='GameDVR_Enabled'; enabled=0; disabled=1 },
  @{ id='disableGameDvr'; path='HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR'; name='AllowGameDVR'; enabled=0; disabled=1 }
)
$backup = [ordered]@{ createdUtc=[DateTime]::UtcNow.ToString('o'); values=@{} }
foreach ($target in $targets) {
  if (-not $flags.PSObject.Properties[$target.id]) { continue }
  $item = Get-ItemProperty -LiteralPath $target.path -Name $target.name -ErrorAction SilentlyContinue
  $oldValue = 0
  if ($item -and $null -ne $item.($target.name)) { $oldValue = $item.($target.name) }
  $backup.values["$($target.path)|$($target.name)"] = $oldValue
}
$backupPath = Join-Path $backupDirectory ('windows-system-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
$backup | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backupPath -Encoding utf8
$results = [System.Collections.Generic.List[object]]::new()
foreach ($target in $targets) {
  if (-not $flags.PSObject.Properties[$target.id]) { continue }
  try {
    New-Item -Path $target.path -Force | Out-Null
    $value = if ($flags.$($target.id)) { $target.enabled } else { $target.disabled }
    New-ItemProperty -LiteralPath $target.path -Name $target.name -PropertyType DWord -Value $value -Force | Out-Null
    $results.Add(@{name=$target.name;ok=$true;value=$value;message=('Set {0} to {1}.' -f $target.name,$value)})
  } catch {
    $results.Add(@{name=$target.name;ok=$false;message=$_.Exception.Message})
  }
}
@{ok=($results.Where({ -not $_.ok }).Count -eq 0);backupPath=$backupPath;results=@($results)} | ConvertTo-Json -Depth 6 -Compress
`;
  const output = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { timeout: 30000 });
  const jsonLine = output.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).at(-1);
  if (!jsonLine) throw new Error(output || 'Windows system script returned no result.');
  const result = JSON.parse(jsonLine);
  log(`Windows system settings saved. Backup: ${result.backupPath}.`, result.ok ? 'OK' : 'WARN');
  return result;
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
  if (original.equals(updated)) {
    await runProcess('attrib.exe', ['+R', configPath], { timeout: 10000 });
    return { changed: false, readOnlyRestored: true, message: 'The selected settings already match the file; Read-Only is set.' };
  }

  const backupPath = `${configPath}.bak`;
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    const backupStat = await fs.lstat(backupPath);
    if (!backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error('The Fortnite backup path is not a regular file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.copyFile(configPath, backupPath);
  await runProcess('attrib.exe', ['-R', configPath], { timeout: 10000 });
  try {
    await fs.writeFile(temporaryPath, updated, { flag: 'wx' });
    await fs.rename(temporaryPath, configPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await runProcess('attrib.exe', ['+R', configPath], { timeout: 10000 });
  }
  return { changed: true, backupPath, readOnlyRestored: true, settingsChanged: changes.map(([, key]) => key) };
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
      'flushDns' { $output = & ipconfig.exe /flushdns 2>&1; if ($LASTEXITCODE -ne 0) { throw ($output -join ' ') }; $results.Add(@{name=$option;ok=$true;message='DNS resolver cache flushed with ipconfig.'}) }
      'cloudflareDns' { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @('1.1.1.1','1.0.0.1'); $results.Add(@{name=$option;ok=$true;message='Cloudflare DNS set on the active adapter.'}) }
      'tcpAutoTuning' { $output = & netsh.exe int tcp set global autotuninglevel=normal 2>&1; if ($LASTEXITCODE -ne 0) { throw ($output -join ' ') }; $output = & netsh.exe int tcp set global ecncapability=enabled 2>&1; if ($LASTEXITCODE -ne 0) { throw ($output -join ' ') }; $results.Add(@{name=$option;ok=$true;message='TCP auto-tuning set to normal and ECN enabled.'}) }
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
      ['CPU power plan', optimizeCpuPowerPlan],
      ['Background memory scan', auditBackgroundMemory]
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

async function runWinUtilGamingProfile() {
  assertWindows();
  if (optimizerInProgress) throw new Error('An optimization sequence is already running.');
  optimizerInProgress = true;
  const profileDirectory = path.join(app.getPath('userData'), 'profiles');
  const profilePath = path.join(profileDirectory, 'booster-gaming-profile.json');
  try {
    await fs.mkdir(profileDirectory, { recursive: true });
    await fs.writeFile(profilePath, `${JSON.stringify(WINUTIL_GAMING_PROFILE, null, 2)}\n`, 'utf8');
    const profilePathBase64 = Buffer.from(profilePath, 'utf8').toString('base64');
    const innerPowerShell = String.raw`
$ErrorActionPreference = 'Stop'
$profilePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${profilePathBase64}'))
$source = Invoke-RestMethod -Uri 'https://christitus.com/win' -ErrorAction Stop
if ([string]::IsNullOrWhiteSpace($source)) { throw 'The official WinUtil release returned an empty script.' }
$winutil = [ScriptBlock]::Create($source)
& $winutil -Config $profilePath -Run
if ($global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }
`;
    const innerCommand = Buffer.from(innerPowerShell, 'utf16le').toString('base64');
    const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$command = '${innerCommand}'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  & ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($command))))
  if ($global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }
  exit 0
}
$powershellPath = Join-Path $PSHOME 'powershell.exe'
$outputPath = Join-Path $env:TEMP ('booster-winutil-' + [guid]::NewGuid().ToString('N') + '.out')
$errorPath = Join-Path $env:TEMP ('booster-winutil-' + [guid]::NewGuid().ToString('N') + '.err')
try {
  $process = Start-Process -FilePath $powershellPath -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-EncodedCommand',$command) -Verb RunAs -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath -ErrorAction Stop
  if (Test-Path -LiteralPath $outputPath) { Get-Content -LiteralPath $outputPath -Raw }
  if ($process.ExitCode -ne 0) {
    $details = if (Test-Path -LiteralPath $errorPath) { Get-Content -LiteralPath $errorPath -Raw } else { 'No error details were returned.' }
    throw "WinUtil exited with code $($process.ExitCode): $details"
  }
} finally {
  Remove-Item -LiteralPath $outputPath,$errorPath -Force -ErrorAction SilentlyContinue
}
`;
    log('Starting the curated Chris Titus Tech gaming profile in a hidden PowerShell process. Windows may request administrator approval.', 'ACTION');
    const output = await runProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', powershell
    ], { timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
    const outputTail = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-8);
    if (outputTail.length) log(`WinUtil report: ${outputTail.join(' · ')}`, 'INFO');
    log(`WinUtil gaming profile completed. Profile file: ${profilePath}`, 'OK');
    return {
      ok: true,
      profilePath,
      message: 'WinUtil completed the selected Booster profile: create a restore point, enable Windows Game Mode, and set Windows visual effects for performance. Reboot if Windows or WinUtil reports one is needed; this does not promise a fixed FPS increase.'
    };
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
  handle('booster:run-winutil-gaming-profile', runWinUtilGamingProfile);
  handle('booster:optimize-cpu', optimizeCpuPowerPlan);
  handle('booster:scan-background-memory', auditBackgroundMemory);
  handle('booster:apply-windows-tweaks', applyWindowsTweaks);
  handle('booster:update-fortnite-settings', updateFortniteSettings);
  handle('booster:run-network-optimization', runNetworkOptimization);
  handle('booster:get-storage-overview', getStorageOverview);
  handle('booster:scan-drive-cleanup', scanDriveCleanup);
  handle('booster:delete-cleanup-candidates', moveCleanupCandidatesToRecycleBin);
  handle('booster:scan-controller', scanController);
  handle('booster:get-service-status', getServiceStatus);
  handle('booster:measure-network-quality', measureNetworkQuality);
  handle('booster:measure-region', measureRegion);
  handle('booster:open-sound-settings', openSoundSettings);
  handle('booster:open-mouse-settings', openMouseSettings);
  handle('booster:open-epic-launcher', openEpicLauncher);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
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
