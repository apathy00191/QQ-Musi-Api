/**
 * 网关配置解析 (全部来自环境变量).
 *
 * 环境变量:
 *   PORT             监听端口 (默认 3400)
 *   HOST             监听地址 (默认 0.0.0.0)
 *   AUTH_MODE        token | open (默认 token)
 *   ADMIN_TOKEN      管理令牌; 未设则读 DATA_DIR/admin-token, 不存在则生成随机 hex 32 并写文件
 *   DATA_DIR         数据目录 (默认 ./data, 启动时 mkdir recursive)
 *   UPSTREAM_V2      扩展服务地址 (默认 http://127.0.0.1:3200)
 *   DEVICE_PATH      设备信息持久化路径 (默认 DATA_DIR/device.json)
 *   CREDENTIAL_PATH  凭证持久化路径 (默认 DATA_DIR/credential.json)
 *   PLATFORM         android | desktop | web (默认 android)
 *   V2_AUTOSTART     1 时由网关拉起扩展服务 (默认 0; 当前仅解析, 见 README/部署说明)
 *   V2_DIR           扩展服务目录 (可选)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { Platform } from "./vendor/qqmusic/versioning.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 项目根目录 (QQMusicApi/) */
export const ROOT_DIR = resolve(__dirname, "..");

/** 相对路径按进程工作目录解析 (与 node server.js 的运行目录一致) */
function resolvePath(p) {
  return isAbsolute(p) ? p : resolve(p);
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * 加载配置: 解析环境变量、确保 DATA_DIR 存在、解析/生成管理令牌.
 * @returns {object} 配置对象 (只读语义, 由 server.js 注入各模块)
 */
export function loadConfig(env = process.env) {
  const dataDir = resolvePath(env.DATA_DIR?.trim() || "./data");

  // DATA_DIR 递归创建
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // ---- 管理令牌 ----
  let adminToken;
  let adminTokenSource;
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.trim()) {
    adminToken = env.ADMIN_TOKEN.trim();
    adminTokenSource = "env";
  } else {
    const tokenFile = join(dataDir, "admin-token");
    if (existsSync(tokenFile)) {
      const v = readFileSync(tokenFile, "utf-8").trim();
      if (v) {
        adminToken = v;
        adminTokenSource = "file";
      }
    }
    if (!adminToken) {
      adminToken = randomBytes(16).toString("hex"); // 32 位 hex
      writeFileSync(tokenFile, adminToken, "utf-8");
      adminTokenSource = "file";
    }
  }

  const authMode = (env.AUTH_MODE?.trim() || "token").toLowerCase() === "open" ? "open" : "token";
  const platformStr = (env.PLATFORM?.trim() || "android").toLowerCase();
  const platform =
    platformStr === "desktop"
      ? Platform.DESKTOP
      : platformStr === "web"
        ? Platform.WEB
        : Platform.ANDROID;

  const devicePath = env.DEVICE_PATH?.trim()
    ? resolvePath(env.DEVICE_PATH.trim())
    : join(dataDir, "device.json");
  const credentialPath = env.CREDENTIAL_PATH?.trim()
    ? resolvePath(env.CREDENTIAL_PATH.trim())
    : join(dataDir, "credential.json");

  return Object.freeze({
    version: readVersion(),
    port: Number(env.PORT ?? 3400) || 3400,
    host: env.HOST?.trim() || "0.0.0.0",
    authMode,
    adminToken,
    adminTokenSource,
    dataDir,
    tokensPath: join(dataDir, "tokens.json"),
    statsPath: join(dataDir, "stats.json"),
    upstreamV2: (env.UPSTREAM_V2?.trim() || "http://127.0.0.1:3200").replace(/\/+$/, ""),
    devicePath,
    credentialPath,
    platform,
    platformName: platformStr === "desktop" ? "desktop" : platformStr === "web" ? "web" : "android",
    v2Autostart: env.V2_AUTOSTART?.trim() === "1",
    v2Dir: env.V2_DIR?.trim() || null,
    publicDir: join(ROOT_DIR, "public"),
  });
}
