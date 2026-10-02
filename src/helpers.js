/**
 * 共享辅助: 统一响应、错误处理、静态服务、原子写、恒定时间比较.
 * server.js 会把本模块整体注入各路由工厂 (含 v2 路由).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";

// ==================== 统一响应 ====================

/** 统一成功响应: { code: 0, message: "ok", data } */
export function ok(data, meta) {
  return { code: 0, message: "ok", data, ...(meta ? { meta } : {}) };
}

/** 统一失败响应: { code: <非0>, message, data? } */
export function fail(code, message, data) {
  const body = { code, message };
  if (data !== undefined) body.data = data;
  return body;
}

/**
 * 全局错误处理中间件 (参考项目1 src/server.js errorHandler).
 * 异步路由抛出的异常统一序列化为 JSON, 并设置对应 HTTP 状态码.
 */
export async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (e) {
    const err = e;
    // 兼容 http-errors 的 status / statusCode (koa-bodyparser 解析错误仅带 status)
    const raw = err.statusCode ?? err.status;
    const status = typeof raw === "number" && raw >= 400 ? raw : 500;
    const code = typeof err.code === "number" ? err.code : status;
    ctx.status = status;
    ctx.body = fail(code, err.message || "Internal Server Error", err.data);
    if (status >= 500) {
      console.error("[QQMusicApi]", err);
    }
  }
}

/** 未匹配任何路由时的统一 404 JSON */
export function notFoundHandler(ctx) {
  ctx.status = 404;
  ctx.body = fail(404, `Not Found: ${ctx.method} ${ctx.path}`);
}

// ==================== 安全比较 ====================

/** 恒定时间字符串比较 (先做 sha256, 避免长度侧信道) */
export function timingSafeEqualStr(a, b) {
  const ba = createHash("sha256").update(String(a ?? ""), "utf-8").digest();
  const bb = createHash("sha256").update(String(b ?? ""), "utf-8").digest();
  return timingSafeEqual(ba, bb);
}

// ==================== 文件工具 ====================

/** JSON 原子写 (tmp + rename), 自动创建父目录 */
export function atomicWriteJson(filePath, value) {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

/** 读取 JSON 文件, 不存在或损坏时返回 fallback */
export function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

// ==================== 静态文件服务 ====================

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** 按扩展名返回 Content-Type (无新依赖, 未命中回退 octet-stream) */
export function mimeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * 静态服务中间件:
 *   GET /                -> public/index.html
 *   其余 GET             -> public/<URL路径> 或 public/<URL去掉/public前缀> 存在即提供
 * 文件不存在时交给后续路由处理 (最终 404 JSON).
 */
export function createStaticMiddleware(publicDir) {
  const root = resolve(publicDir);

  /** 将 URL 路径映射为 public 目录内的绝对路径, 越界返回 null */
  const mapFile = (urlPath) => {
    let rel = decodeURIComponent(urlPath.split("?")[0]);
    if (rel.startsWith("/public/")) rel = rel.slice("/public".length);
    rel = normalize(rel).replace(/^([/\\])+/, "");
    const abs = resolve(join(root, rel));
    if (abs !== root && !abs.startsWith(root + sep)) return null; // 防目录穿越
    return abs;
  };

  return async function staticMiddleware(ctx, next) {
    if (ctx.method !== "GET" && ctx.method !== "HEAD") return next();

    let file = null;
    if (ctx.path === "/") {
      file = join(root, "index.html");
      if (!existsSync(file)) return next(); // UI 待补 -> 404 JSON
    } else {
      const candidate = mapFile(ctx.path);
      if (!candidate) return next();
      // /public/* 与 favicon 直接给 404 JSON, 不再尝试其他映射
      if (existsSync(candidate)) {
        file = candidate;
      } else {
        return next();
      }
    }

    try {
      const stat = readFileSync(file);
      ctx.status = 200;
      ctx.type = mimeFor(file);
      ctx.length = stat.length;
      // Koa 对 HEAD 会自动不发送响应体
      ctx.body = stat;
    } catch {
      return next();
    }
  };
}
