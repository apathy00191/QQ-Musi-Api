// src/routes/v2.js
// 统一网关 /api/v2/* → 扩展 TS 服务（各种qq音乐api，默认 http://127.0.0.1:3200）透明代理。
// 固定契约: export default function createV2Router({ config, helpers }) → Koa Router 实例（prefix: /api/v2）
// 附加导出: export async function stopV2Child() — 优雅退出时终止自动拉起的子进程。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Router from '@koa/router';
import { Agent, request as undiciRequest } from 'undici';

/* ---------------------------- 常量 ---------------------------- */
const ROUTER_PREFIX = '/api/v2';
const GATEWAY_UA = 'QQMusicApi/1.0';
const DEFAULT_UPSTREAM = 'http://127.0.0.1:3200';
const UPSTREAM_TIMEOUT_MS = 15000; // 上游连接 / 响应头 / 响应体空闲超时
const HEALTH_TIMEOUT_MS = 1500; // _status 健康探测超时
const AUTO_START_DELAY_MS = 1000; // 模块加载后的延迟拉起时间
const RESTART_DELAY_MS = 3000; // 子进程退出后 3 秒重试
const MAX_CONSECUTIVE_FAILURES = 5; // 连续失败上限，超过即放弃
const LONG_RUN_RESET_MS = 30000; // 存活超过该时长视为一次成功运行，重置失败计数

// 请求头白名单（authorization / x-admin-token / host / connection / content-length 一律剥离）
const REQ_HEADER_WHITELIST = ['content-type', 'accept', 'cookie', 'x-custom-cookie', 'accept-language'];
// 响应头透传（状态码 + content-type 原样回传，其余仅透传无害的语义头）
const RES_HEADER_PASSTHROUGH = [
  'content-type',
  'content-encoding',
  'content-length',
  'cache-control',
  'etag',
  'last-modified',
  'content-disposition',
];

/* --------------------- 共享上游 dispatcher（15s 超时） --------------------- */
const v2Agent = new Agent({
  connect: { timeout: UPSTREAM_TIMEOUT_MS },
  headersTimeout: UPSTREAM_TIMEOUT_MS,
  bodyTimeout: UPSTREAM_TIMEOUT_MS,
});

/* ------------------------ 防御性 helpers ------------------------ */
function normalizeHelpers(helpers) {
  const fallback = {
    ok(data, meta) {
      const out = { code: 0, message: 'ok', data };
      if (meta && typeof meta === 'object') Object.assign(out, meta);
      return out;
    },
    fail(code, message, data) {
      return { code, message, data };
    },
  };
  if (!helpers || typeof helpers !== 'object') return fallback;
  return {
    ok: typeof helpers.ok === 'function' ? helpers.ok.bind(helpers) : fallback.ok,
    fail: typeof helpers.fail === 'function' ? helpers.fail.bind(helpers) : fallback.fail,
  };
}

/* ------------------------ 防御性 config 读取 ------------------------ */
function pickConfig(config, keys, fallback) {
  if (!config || typeof config !== 'object') return fallback;
  for (const key of keys) {
    const value = config[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

function asEnabled(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase());
  return false;
}

function normalizeUpstream(value) {
  const raw = String(value ?? '').trim() || DEFAULT_UPSTREAM;
  return raw.replace(/\/+$/, '');
}

function resolveUpstreamPort(upstream) {
  try {
    const port = Number(new URL(upstream).port);
    return Number.isInteger(port) && port > 0 ? port : 3200;
  } catch {
    return 3200;
  }
}

function readUpstream(config) {
  return normalizeUpstream(
    pickConfig(
      config,
      ['upstreamV2', 'UPSTREAM_V2', 'upstreamV2Url', 'UPSTREAM_V2_URL', 'v2Upstream', 'V2_UPSTREAM', 'upstream', 'UPSTREAM'],
      DEFAULT_UPSTREAM,
    ),
  );
}

/* --------------------- 扩展子进程状态（供 _status.spawned） --------------------- */
const childState = {
  child: null,
  autostartScheduled: false,
  stopRequested: false,
  consecutiveFailures: 0,
  restartTimer: null,
  startedAt: 0,
  lastExit: null,
};

function isChildAlive() {
  const child = childState.child;
  return !!child && child.exitCode === null && child.signalCode === null;
}

/* ---------------------------- autostart ---------------------------- */
function resolveTsxEntry(v2Dir) {
  const pkgJson = path.join(v2Dir, 'node_modules', 'tsx', 'package.json');
  try {
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      let bin = pkg.bin;
      if (bin && typeof bin === 'object') bin = bin.tsx;
      if (typeof bin === 'string' && bin) return path.join(v2Dir, 'node_modules', 'tsx', bin);
    }
  } catch {
    // 忽略，走兜底位置
  }
  for (const rel of ['dist/cli.mjs', 'dist/cli.js']) {
    const candidate = path.join(v2Dir, 'node_modules', 'tsx', rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveLauncher(v2Dir) {
  const distApp = path.join(v2Dir, 'dist', 'app.js');
  if (fs.existsSync(distApp)) {
    return { cmd: process.execPath, args: ['dist/app.js'], label: 'node dist/app.js', shell: false };
  }
  const binDir = path.join(v2Dir, 'node_modules', '.bin');
  const tsxUnix = path.join(binDir, 'tsx');
  const tsxCmd = path.join(binDir, 'tsx.cmd');
  if (!fs.existsSync(tsxUnix) && !fs.existsSync(tsxCmd)) return null;

  if (process.platform !== 'win32') {
    return fs.existsSync(tsxUnix)
      ? { cmd: tsxUnix, args: ['src/app.ts'], label: 'tsx src/app.ts', shell: false }
      : { cmd: tsxCmd, args: ['src/app.ts'], label: 'tsx.cmd src/app.ts', shell: false };
  }

  // Windows：Node 禁止无 shell 直接 spawn .cmd，且路径可能含空格，
  // 优先用 tsx 包的 JS 入口通过 node 启动（与规格的 .bin/tsx 存在性判断保持一致）。
  const tsxEntry = resolveTsxEntry(v2Dir);
  if (tsxEntry) {
    return {
      cmd: process.execPath,
      args: [tsxEntry, 'src/app.ts'],
      label: `node ${path.relative(v2Dir, tsxEntry)} src/app.ts`,
      shell: false,
    };
  }
  const cmdPath = fs.existsSync(tsxCmd) ? tsxCmd : tsxUnix;
  // 兜底：shell:true 且命令整体加引号，兼容含空格路径
  return { cmd: `"${cmdPath}"`, args: ['src/app.ts'], label: 'tsx bin (shell)', shell: true };
}

function launchV2Child(v2Dir, upstream) {
  if (childState.stopRequested || isChildAlive()) return;
  const launcher = resolveLauncher(v2Dir);
  if (!launcher) {
    console.warn('[ext] 警告: 既无 dist/app.js 也无 node_modules/.bin/tsx(.cmd)，跳过自动拉起');
    return;
  }

  const port = resolveUpstreamPort(upstream);
  let child;
  try {
    child = spawn(launcher.cmd, launcher.args, {
      cwd: v2Dir,
      env: { ...process.env, PORT: String(port) },
      shell: launcher.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    console.error(`[ext] 扩展服务启动异常: ${err && err.message}`);
    scheduleRestart(v2Dir, upstream);
    return;
  }

  childState.child = child;
  childState.startedAt = Date.now();
  console.log(`[ext] 正在拉起扩展服务 (PORT=${port}): ${launcher.label}`);

  const forward = (stream) => {
    if (!stream) return;
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(`[ext] ${line}`);
    });
    stream.on('end', () => {
      if (buffered.trim()) console.log(`[ext] ${buffered}`);
    });
  };
  forward(child.stdout);
  forward(child.stderr);

  let settled = false;
  const settle = (reason) => {
    if (settled) return;
    settled = true;
    childState.child = null;
    if (childState.stopRequested) {
      console.log(`[ext] 扩展服务已停止 (${reason})`);
      return;
    }
    scheduleRestart(v2Dir, upstream, reason);
  };

  child.on('error', (err) => {
    console.error(`[ext] 扩展服务启动失败: ${err && err.message}`);
    settle('error');
  });
  child.on('exit', (code, signal) => {
    childState.lastExit = { code, signal, at: Date.now() };
    console.error(`[ext] 扩展服务退出 (code=${code}, signal=${signal})`);
    settle('exit');
  });
}

function scheduleRestart(v2Dir, upstream, reason = 'exit') {
  if (childState.stopRequested || childState.restartTimer) return;
  const uptime = Date.now() - childState.startedAt;
  if (uptime >= LONG_RUN_RESET_MS) childState.consecutiveFailures = 0;
  if (childState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error(`[ext] 扩展服务连续失败 ${childState.consecutiveFailures} 次，放弃自动重启 (${reason})`);
    return;
  }
  childState.consecutiveFailures += 1;
  console.warn(
    `[ext] ${RESTART_DELAY_MS}ms 后重启扩展服务 (连续第 ${childState.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} 次, 原因: ${reason})`,
  );
  const timer = setTimeout(() => {
    childState.restartTimer = null;
    launchV2Child(v2Dir, upstream);
  }, RESTART_DELAY_MS);
  if (typeof timer.unref === 'function') timer.unref();
  childState.restartTimer = timer;
}

function maybeAutostart(config, upstream) {
  if (childState.autostartScheduled) return;
  const enabled = asEnabled(pickConfig(config, ['v2Autostart', 'V2_AUTOSTART', 'autostart', 'AUTOSTART'], 0));
  if (!enabled) return;
  childState.autostartScheduled = true;

  const v2Dir = pickConfig(config, ['v2Dir', 'V2_DIR', 'upstreamV2Dir', 'UPSTREAM_V2_DIR', 'extDir'], undefined);
  if (!v2Dir || !fs.existsSync(v2Dir)) {
    console.warn(`[ext] 警告: v2Autostart 已开启但 v2Dir 缺失或不存在 (${v2Dir ?? 'undefined'})，跳过自动拉起`);
    return;
  }
  console.log(`[ext] 已安排延迟自动拉起扩展服务: ${v2Dir}`);
  const timer = setTimeout(() => launchV2Child(v2Dir, upstream), AUTO_START_DELAY_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

/* ---------------------------- 健康探测 ---------------------------- */
async function probeUpstream(upstream) {
  try {
    const res = await undiciRequest(`${upstream}/getHotkey`, {
      method: 'GET',
      headersTimeout: HEALTH_TIMEOUT_MS,
      bodyTimeout: HEALTH_TIMEOUT_MS,
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    try {
      if (res.body && typeof res.body.dump === 'function') await res.body.dump();
      else if (res.body) await res.body.text();
    } catch {
      // 响应体读取失败不影响连通性判断
    }
    return true;
  } catch {
    return false;
  }
}

/* --------------------------- 请求体构造 --------------------------- */
function hasBodyIndicator(ctx) {
  const len = Number(ctx.get('content-length'));
  if (Number.isFinite(len) && len > 0) return true;
  return /chunked/i.test(ctx.get('transfer-encoding') || '');
}

async function buildUpstreamBody(ctx) {
  const method = String(ctx.method || 'GET').toUpperCase();
  // 规格: GET / DELETE 无 body
  if (method === 'GET' || method === 'DELETE') return { body: undefined, contentType: undefined };

  // 1) 原始 raw body（koa-bodyparser returnRawBody=true 时可用）→ 字节原样透传
  const raw = ctx.request && ctx.request.rawBody;
  if (typeof raw === 'string' && raw.length > 0) {
    return { body: raw, contentType: ctx.get('content-type') || 'application/json' };
  }
  if (Buffer.isBuffer(raw) && raw.length > 0) {
    return { body: raw, contentType: ctx.get('content-type') || 'application/json' };
  }

  // 2) bodyparser 已解析的 body → JSON 转发（raw 不可用时的兼容路径）
  const parsed = ctx.request ? ctx.request.body : undefined;
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed) && parsed.length > 0) {
      return { body: parsed, contentType: ctx.get('content-type') || 'application/json' };
    }
    if (typeof parsed === 'string') {
      return parsed.length > 0
        ? { body: parsed, contentType: ctx.get('content-type') || 'application/json' }
        : { body: undefined, contentType: undefined };
    }
    if (typeof parsed === 'object') {
      const empty = !Array.isArray(parsed) && Object.keys(parsed).length === 0;
      if (!empty) return { body: JSON.stringify(parsed), contentType: 'application/json' };
      // 空对象 = bodyparser 未覆盖该类型且无 rawBody → 走下面的原始流兜底
    } else {
      return { body: JSON.stringify(parsed), contentType: 'application/json' };
    }
  }

  // 3) bodyparser 未覆盖的类型（如 multipart）且流未被消费 → 自行排空原始请求流
  if (hasBodyIndicator(ctx)) {
    try {
      const chunks = [];
      for await (const chunk of ctx.req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      if (buf.length > 0) {
        return { body: buf, contentType: ctx.get('content-type') || 'application/octet-stream' };
      }
    } catch (err) {
      console.warn(`[ext] 读取原始请求体失败: ${err && err.message}`);
    }
  }
  return { body: undefined, contentType: undefined };
}

/* ----------------------------- 路由处理器 ----------------------------- */
function createStatusHandler(upstream, autostartEnabled, helpers) {
  return async (ctx) => {
    const healthy = await probeUpstream(upstream);
    ctx.body = helpers.ok({
      upstream,
      healthy,
      autostart: autostartEnabled,
      spawned: isChildAlive(),
    });
  };
}

function createProxyHandler(upstream, helpers) {
  return async (ctx) => {
    const restRaw = ctx.path.slice(ROUTER_PREFIX.length);
    const rest = restRaw.startsWith('/') ? restRaw : `/${restRaw}`;
    const target = `${upstream}${rest || '/'}${ctx.search || ''}`;

    const { body, contentType } = await buildUpstreamBody(ctx);

    // 请求头白名单转发 + 网关 UA；authorization / host / connection / content-length 等一律剥离
    const headers = {};
    for (const name of REQ_HEADER_WHITELIST) {
      const value = ctx.get(name);
      if (value) headers[name] = value;
    }
    headers['user-agent'] = GATEWAY_UA;
    if (body !== undefined) headers['content-type'] = contentType || 'application/json';

    try {
      const res = await undiciRequest(target, {
        method: ctx.method,
        headers,
        body,
        dispatcher: v2Agent,
        headersTimeout: UPSTREAM_TIMEOUT_MS,
        bodyTimeout: UPSTREAM_TIMEOUT_MS,
      });

      // 状态码与关键响应头原样回传；响应体以 stream 写回，避免大 JSON 占内存
      ctx.status = res.statusCode;
      for (const name of RES_HEADER_PASSTHROUGH) {
        const value = res.headers[name];
        const single = Array.isArray(value) ? value.join(', ') : value;
        if (single !== undefined && single !== null && single !== '') ctx.set(name, String(single));
      }
      res.body.on('error', (err) => {
        console.error(`[ext] 上游响应体流错误 (${ctx.method} ${target}): ${err && err.message}`);
        try {
          if (!ctx.res.writableEnded) ctx.res.destroy(err);
        } catch {
          // 忽略销毁异常
        }
      });
      ctx.body = res.body;
    } catch (err) {
      // 连接被拒 / 超时 → 502（此刻尚未向客户端写出任何数据）
      console.error(`[ext] 代理失败 ${ctx.method} ${target}: ${err && err.message}`);
      if (!ctx.res.headersSent) {
        ctx.status = 502;
        ctx.body = helpers.fail(502, '扩展上游服务不可用，请先启动 UPSTREAM_V2 指向的服务', { upstream });
      }
    }
  };
}

/* ------------------------------ 工厂 ------------------------------ */
export default function createV2Router(options = {}) {
  const { config, helpers: rawHelpers } = options || {};
  const helpers = normalizeHelpers(rawHelpers);

  const upstream = readUpstream(config);
  const autostartEnabled = asEnabled(pickConfig(config, ['v2Autostart', 'V2_AUTOSTART', 'autostart', 'AUTOSTART'], 0));

  const router = new Router({ prefix: ROUTER_PREFIX });

  // 状态接口（不代理）：任意方法均返回状态，永不转发到上游
  router.all('/_status', createStatusHandler(upstream, autostartEnabled, helpers));

  // 其余路径 / 方法全部转发（path-to-regexp 6 裸 (.*) 捕获全部子路径）
  router.all('/(.*)', createProxyHandler(upstream, helpers));

  maybeAutostart(config, upstream);

  return router;
}

// 兼容具名导入（旧 stub 同时导出了具名 createV2Router）
export { createV2Router };

/* --------------------- 优雅退出：终止自动拉起的子进程 --------------------- */
export async function stopV2Child() {
  childState.stopRequested = true;
  if (childState.restartTimer) {
    clearTimeout(childState.restartTimer);
    childState.restartTimer = null;
  }
  const child = childState.child;
  childState.child = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 已退出则忽略
      }
      finish();
    }, 3000);
    if (typeof killer.unref === 'function') killer.unref();
    try {
      child.kill();
    } catch {
      finish();
    }
  });
}
