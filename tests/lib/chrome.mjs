import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome(env = process.env) {
  const candidates = [];
  if (env.CHROME_PATH) candidates.push(env.CHROME_PATH);

  try {
    const browserRoot = '/opt/pw-browsers';
    for (const entry of fs.readdirSync(browserRoot)) {
      if (entry.startsWith('chromium-')) {
        candidates.push(path.join(browserRoot, entry, 'chrome-linux', 'chrome'));
      }
    }
  } catch {}

  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else if (process.platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    candidates.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }

  for (const candidate of candidates) {
    if (isExecutable(candidate, env)) return candidate;
  }
  return null;
}

function isExecutable(candidate, env) {
  if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const pathDirs = (env.PATH || '').split(path.delimiter);
  return pathDirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, candidate), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export async function launchChrome({ headed = false, executablePath = findChrome() } = {}) {
  if (!executablePath) {
    throw new Error('Chrome / Chromium が見つかりません。CHROME_PATH を指定してください。');
  }

  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'avz-chrome-'));
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    'about:blank'
  ];
  if (!headed) args.unshift('--headless=new');

  const child = spawn(executablePath, args, { stdio: 'ignore' });
  let spawnError = null;
  child.once('error', (error) => { spawnError = error; });
  let closed = false;
  const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
  let port;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (spawnError) {
      await fsp.rm(userDataDir, { recursive: true, force: true });
      throw new Error(`Chrome の起動に失敗しました: ${spawnError.message}`);
    }
    if (child.exitCode !== null) throw new Error(`Chrome が起動コード ${child.exitCode} で終了しました。`);
    try {
      port = Number((await fsp.readFile(activePortPath, 'utf8')).split(/\r?\n/)[0]);
      if (port > 0) break;
    } catch {}
    await sleep(100);
  }
  if (!port) {
    child.kill();
    await fsp.rm(userDataDir, { recursive: true, force: true });
    throw new Error('DevToolsActivePort が10秒以内に生成されませんでした。');
  }

  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = tabs.find((tab) => tab.type === 'page' && tab.webSocketDebuggerUrl);
  if (!page) throw new Error('Chrome の DevTools ページを取得できませんでした。');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  const errors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails?.text || '未捕捉例外');
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' ') || 'console.error');
    }
    for (const handler of listeners.get(message.method) || []) handler(message.params);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
  };
  const evaluate = async (expression, { awaitPromise = true, timeoutMs = 30_000 } = {}) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: timeoutMs
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'ブラウザー評価に失敗しました。');
    return result.result?.value;
  };
  const navigate = async (fileUrl) => {
    errors.length = 0;
    await send('Page.enable');
    const loaded = new Promise((resolve) => {
      let timer;
      const remove = on('Page.loadEventFired', () => {
        clearTimeout(timer);
        remove();
        resolve();
      });
      timer = setTimeout(() => {
        remove();
        resolve();
      }, 10_000);
    });
    await send('Page.navigate', { url: fileUrl });
    await loaded;
  };
  await send('Runtime.enable');
  await send('Page.enable');

  return {
    send,
    on,
    evaluate,
    navigate,
    errors,
    async close() {
      if (closed) return;
      closed = true;
      try { socket.close(); } catch {}
      child.kill();
      await fsp.rm(userDataDir, { recursive: true, force: true });
    }
  };
}
