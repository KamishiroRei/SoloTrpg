const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function runtimeRoot() {
  return path.resolve(__dirname, '..');
}

function runtimeDir() {
  return path.join(runtimeRoot(), 'data', 'runtime');
}

function launcherLockPath() {
  return path.join(runtimeDir(), 'launcher.lock');
}

function normalize(value) {
  return path.resolve(String(value || '')).toLowerCase();
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getProcessInfo(pid) {
  if (!pid || process.platform !== 'win32') return { pid };
  try {
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    if (!out) return { pid };
    const info = JSON.parse(out);
    return {
      pid: Number(info.ProcessId || pid),
      name: info.Name || '',
      executablePath: info.ExecutablePath || '',
      commandLine: info.CommandLine || ''
    };
  } catch (e) {
    return { pid, error: e.message };
  }
}

function isSameProjectLauncher(lock, pid) {
  if (!lock || Number(lock.launcherPid) !== Number(pid)) return false;
  return normalize(lock.runtimeRoot) === normalize(runtimeRoot());
}

function killProcessTree(pid) {
  if (!pid || Number(pid) === process.pid || process.platform !== 'win32') return false;
  try {
    execSync(`taskkill /PID ${Number(pid)} /T /F`, { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function prepareLauncher(launcherPid) {
  const pid = Number(launcherPid || 0);
  if (!pid) return;
  const lockFile = launcherLockPath();
  const oldLock = readJson(lockFile);
  if (oldLock && oldLock.launcherPid && oldLock.launcherPid !== pid && isSameProjectLauncher(oldLock, oldLock.launcherPid)) {
    const info = getProcessInfo(oldLock.launcherPid);
    const name = String(info.name || '').toLowerCase();
    if (name === 'cmd.exe' || name === 'conhost.exe' || name === 'windowsterminal.exe') {
      const killed = killProcessTree(oldLock.launcherPid);
      console.log(killed
        ? `[启动管理] 已关闭旧 start.bat 窗口 PID=${oldLock.launcherPid}`
        : `[启动管理] 旧 start.bat 窗口关闭失败 PID=${oldLock.launcherPid}`);
    }
  }

  writeJson(lockFile, {
    launcherPid: pid,
    runtimeRoot: runtimeRoot(),
    startedAt: new Date().toISOString()
  });
}

function cleanupLauncher(launcherPid) {
  const pid = Number(launcherPid || 0);
  const lockFile = launcherLockPath();
  const lock = readJson(lockFile);
  if (lock && Number(lock.launcherPid) === pid) {
    try { fs.unlinkSync(lockFile); } catch (e) { /* ignore */ }
  }
}

function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const pid = Number(argv[1] || 0);
  if (cmd === '--prepare-launcher') return prepareLauncher(pid);
  if (cmd === '--cleanup-launcher') return cleanupLauncher(pid);
  console.log('Usage: node startup-manager.js --prepare-launcher <pid> | --cleanup-launcher <pid>');
}

if (require.main === module) main();

module.exports = { prepareLauncher, cleanupLauncher, getProcessInfo, killProcessTree };
