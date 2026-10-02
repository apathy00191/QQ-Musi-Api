/**
 * 鉴权中间件 (挂在业务路由与静态服务之前).
 *
 * 规则:
 *   - 公开路径 (跳过鉴权): GET /, GET /health, GET /docs.json, /public/*, favicon
 *   - /admin/* : 请求头 X-Admin-Token 恒定时间比较, 失败 401 {code:401,message:"无效的管理令牌"}
 *   - /api/*   : AUTH_MODE=open 跳过; 否则 Authorization: Bearer <token> 或 ?token=<token>,
 *                必须存在于 tokenStore 且 enabled=true, 校验通过后挂 ctx.state.token 并计数.
 *   - 其余路径 (静态资源等): 放行
 *
 * 状态码约定 (保持一致):
 *   缺少令牌 -> HTTP 401 { code: 401, message: "缺少访问令牌" }
 *   令牌无效/已禁用 -> HTTP 401 { code: 403, message: "无效或已禁用的访问令牌" }
 *   管理令牌错误 -> HTTP 401 { code: 401, message: "无效的管理令牌" }
 */

import { fail, timingSafeEqualStr } from "./helpers.js";

/** 是否为公开路径 */
function isPublicPath(ctx) {
  if (ctx.path === "/" || ctx.path === "/health" || ctx.path === "/docs.json") return true;
  if (ctx.path === "/favicon.ico") return true;
  if (ctx.path === "/public" || ctx.path.startsWith("/public/")) return true;
  return false;
}

/** 从请求中提取 Bearer / query token */
function extractApiToken(ctx) {
  const auth = ctx.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const value = auth.replace(/^bearer\s+/i, "").trim();
    if (value) return value;
  }
  const q = ctx.query?.token;
  if (q && String(q).trim()) return String(q).trim();
  return null;
}

/**
 * 创建鉴权中间件.
 * @param {{ config: object, tokenStore: import("./tokenStore.js").TokenStore }} deps
 */
export function createAuthMiddleware({ config, tokenStore }) {
  return async function auth(ctx, next) {
    // 1. 公开路径
    if (isPublicPath(ctx)) {
      return next();
    }

    // 2. 管理接口: X-Admin-Token
    if (ctx.path === "/admin" || ctx.path.startsWith("/admin/")) {
      const provided = ctx.get("x-admin-token");
      if (!provided || !timingSafeEqualStr(provided, config.adminToken)) {
        ctx.status = 401;
        ctx.body = fail(401, "无效的管理令牌");
        return;
      }
      ctx.state.admin = true;
      return next();
    }

    // 3. 业务接口: Bearer / ?token=
    if (ctx.path === "/api" || ctx.path.startsWith("/api/")) {
      if (config.authMode === "open") {
        return next();
      }
      const value = extractApiToken(ctx);
      if (!value) {
        ctx.status = 401;
        ctx.body = fail(401, "缺少访问令牌");
        return;
      }
      const record = tokenStore.verify(value);
      if (!record) {
        ctx.status = 401;
        ctx.body = fail(403, "无效或已禁用的访问令牌");
        return;
      }
      ctx.state.token = record;
      tokenStore.hit(record.id); // callCount++ / lastUsedAt / 当日统计
      return next();
    }

    // 4. 其余路径 (静态资源等) 放行
    return next();
  };
}

export default createAuthMiddleware;
