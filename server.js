/**
 * QQ Music Gateway - 入口 (纯 JS ESM, 无构建步骤, Linux 直接 `node server.js` 运行).
 *
 * 装配顺序:
 *   errorHandler -> bodyParser -> auth -> 静态服务 -> /health 与 /docs.json
 *   -> admin 路由 -> core 路由 -> v2 路由 -> 监听
 *
 * 环境变量见 src/config.js.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

import Koa from "koa";
import bodyParser from "koa-bodyparser";
import Router from "@koa/router";

import { loadConfig } from "./src/config.js";
import * as helpers from "./src/helpers.js";
import { TokenStore } from "./src/tokenStore.js";
import { createAuthMiddleware } from "./src/auth.js";
import { buildDocs } from "./src/docs.js";
import { createRuntime, createCoreRouter } from "./src/routes/core.js";
import { createAdminRouter } from "./src/routes/admin.js";
import createV2Router from "./src/routes/v2.js";

const config = loadConfig();
const tokenStore = new TokenStore({
  tokensPath: config.tokensPath,
  statsPath: config.statsPath,
});

// 凭证存储 + Client (core 与 admin 路由共享同一实例)
const { store, client } = createRuntime(config);

// ==================== 应用装配 ====================

const app = new Koa();

// 1. 全局错误处理
app.use(helpers.errorHandler);

// 2. JSON body 解析
app.use(bodyParser({ jsonLimit: "1mb" }));

// 3. 鉴权 (在业务路由与静态服务之前)
app.use(createAuthMiddleware({ config, tokenStore }));

// 4. 静态服务 (GET / -> public/index.html, public/ 下文件按 URL 路径提供)
app.use(helpers.createStaticMiddleware(config.publicDir));

// 5. /health 与 /docs.json (公开)
const publicRouter = new Router();
publicRouter.get("/health", (ctx) => {
  ctx.body = helpers.ok({
    status: "ok",
    time: new Date().toISOString(),
    loggedIn: store.credential.isLoggedIn(),
    musicid: store.credential.musicid || null,
  });
});
publicRouter.get("/docs.json", (ctx) => {
  ctx.body = helpers.ok(buildDocs());
});
app.use(publicRouter.routes());

// 6. 管理路由 (/admin/*, X-Admin-Token)
app.use(
  createAdminRouter({ config, helpers, client, store, tokenStore }).routes(),
);

// 7. 核心路由 (/api/v1/*, Bearer token)
app.use(createCoreRouter({ config, helpers, client, credentialStore: store }).routes());

// 8. 扩展代理路由 (/api/v2/*, Bearer token)
app.use(createV2Router({ config, helpers }).routes());

// 9. 未匹配 -> 统一 404 JSON (必须在最后)
app.use(helpers.notFoundHandler);

// ==================== V2_AUTOSTART (可选拉起扩展服务) ====================

/**
 * V2_AUTOSTART=1 且 V2_DIR 指向扩展项目时, 拉起扩展服务子进程.
 * 优先 dist/app.js (生产), 否则回退 npm run dev; 端口取 UPSTREAM_V2 的 PORT.
 * 任何失败只记日志, 不影响网关本身.
 */
function maybeAutostartV2() {
  if (!config.v2Autostart) return null;
  if (!config.v2Dir) {
    console.warn("[qqmusic-gateway] V2_AUTOSTART=1 但未设置 V2_DIR, 跳过扩展服务拉起");
    return null;
  }
  if (!existsSync(config.v2Dir)) {
    console.error(`[qqmusic-gateway] V2_DIR 不存在: ${config.v2Dir}, 跳过扩展服务拉起`);
    return null;
  }

  const childEnv = { ...process.env };
  try {
    const u = new URL(config.upstreamV2);
    if (u.port) childEnv.PORT = u.port;
  } catch {
    /* 保持默认 */
  }

  const distApp = join(config.v2Dir, "dist", "app.js");
  const useDist = existsSync(distApp);
  const cmd = useDist ? process.execPath : "npm";
  const args = useDist ? [distApp] : ["run", "dev"];

  try {
    const child = spawn(cmd, args, {
      cwd: config.v2Dir,
      env: childEnv,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (err) => {
      console.error(`[qqmusic-gateway] 扩展服务拉起失败: ${err.message}`);
    });
    child.on("exit", (code, signal) => {
      console.log(
        `[qqmusic-gateway] 扩展服务子进程退出 (code=${code}, signal=${signal ?? "none"})`,
      );
    });
    console.log(
      `[qqmusic-gateway] 已尝试拉起扩展服务: ${cmd} ${args.join(" ")} (cwd=${config.v2Dir})`,
    );
    return child;
  } catch (e) {
    console.error(`[qqmusic-gateway] 扩展服务拉起失败: ${e.message}`);
    return null;
  }
}

const v2Child = maybeAutostartV2();

// ==================== 启动监听 ====================

const server = app.listen(config.port, config.host, () => {
  console.log("[qqmusic-gateway] ============ 启动信息 ============");
  console.log(`[qqmusic-gateway] 版本        : v${config.version}`);
  console.log(`[qqmusic-gateway] 监听        : http://${config.host}:${config.port}`);
  console.log(`[qqmusic-gateway] AUTH_MODE   : ${config.authMode}`);
  console.log(
    `[qqmusic-gateway] ADMIN_TOKEN  : ${config.adminToken} (source: ${config.adminTokenSource})`,
  );
  console.log(`[qqmusic-gateway] DATA_DIR    : ${config.dataDir}`);
  console.log(`[qqmusic-gateway] UPSTREAM_V2 : ${config.upstreamV2}`);
  console.log(`[qqmusic-gateway] 平台        : ${config.platformName}`);
  console.log("[qqmusic-gateway] =================================");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[qqmusic-gateway] 端口 ${config.port} 已被占用`);
  } else {
    console.error("[qqmusic-gateway] 监听失败:", err);
  }
  process.exit(1);
});

// ==================== 优雅退出 ====================

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  armForceExit();
  console.log(`[qqmusic-gateway] 收到 ${signal}, 正在优雅退出...`);

  if (v2Child && !v2Child.killed) {
    try {
      v2Child.kill();
    } catch {
      /* ignore */
    }
  }

  await new Promise((resolve) => server.close(resolve));
  try {
    await client.close();
  } catch {
    /* ignore */
  }
  await tokenStore.flush();
  console.log("[qqmusic-gateway] 已退出");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// 兜底: 退出流程卡住时 5s 后强制退出 (仅在 shutdown 内启动, 不影响正常运行)
function armForceExit() {
  setTimeout(() => {
    console.error("[qqmusic-gateway] 优雅退出超时, 强制退出");
    process.exit(0);
  }, 5000).unref();
}
