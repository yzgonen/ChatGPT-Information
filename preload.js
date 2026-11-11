'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback function is required.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('booster', Object.freeze({
  launchFortnite: () => ipcRenderer.invoke('booster:launch-fortnite'),
  runOptimizer: () => ipcRenderer.invoke('booster:run-optimizer'),
  runWinUtilGamingProfile: () => ipcRenderer.invoke('booster:run-winutil-gaming-profile'),
  optimizeCpu: () => ipcRenderer.invoke('booster:optimize-cpu'),
  scanBackgroundMemory: () => ipcRenderer.invoke('booster:scan-background-memory'),
  applyWindowsTweaks: (flags) => ipcRenderer.invoke('booster:apply-windows-tweaks', flags),
  updateFortniteSettings: (flags) => ipcRenderer.invoke('booster:update-fortnite-settings', flags),
  runNetworkOptimization: (options) => ipcRenderer.invoke('booster:run-network-optimization', options),
  getStorageOverview: () => ipcRenderer.invoke('booster:get-storage-overview'),
  scanDriveCleanup: (driveLetter) => ipcRenderer.invoke('booster:scan-drive-cleanup', driveLetter),
  deleteCleanupCandidates: (request) => ipcRenderer.invoke('booster:delete-cleanup-candidates', request),
  scanController: () => ipcRenderer.invoke('booster:scan-controller'),
  getServiceStatus: () => ipcRenderer.invoke('booster:get-service-status'),
  measureNetworkQuality: () => ipcRenderer.invoke('booster:measure-network-quality'),
  openSoundSettings: () => ipcRenderer.invoke('booster:open-sound-settings'),
  openMouseSettings: () => ipcRenderer.invoke('booster:open-mouse-settings'),
  openEpicLauncher: () => ipcRenderer.invoke('booster:open-epic-launcher'),
  onLog: (callback) => subscribe('booster:log', callback),
  onHardwareMetrics: (callback) => subscribe('booster:hardware-metrics', callback)
}));
