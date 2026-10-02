/**
 * 管理路由 (前缀 /admin, 需要 X-Admin-Token — 由 auth 中间件统一校验).
 *
 * 包含:
 *   - GET /admin/status      网关状态 (含 UPSTREAM_V2 健康检查)
 *   - Token 管理             GET/POST/PATCH/DELETE /admin/tokens, POST /admin/tokens/:id/rotate
 *   - 统计                   GET /admin/stats
 *   - 登录/凭证              复刻项目1 loginRouter, 路径改写为 /admin/login/*
 *
 * 注意: 凭证类操作只在本路由暴露, 绝不下发给普通 Bearer token.
 */

import Router from "@koa/router";
import { request as undiciRequest } from "undici";

import { QrLoginType } from "../vendor/qqmusic/modules/login.js";

// ==================== 路由: /admin/status ====================

/** 探测上游扩展服务, 任何 HTTP 响应即视为可达, 1500ms 超时/失败为 false */
async function probeUpstream(url) {
  try {
    const resp = await undiciRequest(`${url}/`, {
      method: "GET",
      headersTimeout: 1500,
      bodyTimeout: 1500,
      headers: { "user-agent": "qqmusic-gateway/health-probe" },
    });
    // 释放连接
    try {
      await resp.body.dump();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

function statusRouter({ config, helpers, store, tokenStore }) {
  const router = new Router({ prefix: "/admin" });

  router.get("/status", async (ctx) => {
    const summary = tokenStore.summary();
    const healthy = await probeUpstream(config.upstreamV2);
    ctx.body = helpers.ok({
      version: config.version,
      authMode: config.authMode,
      uptime: Math.round(process.uptime()),
      adminTokenSource: config.adminTokenSource,
      tokenCount: summary.total,
      enabledTokenCount: summary.enabled,
      loggedIn: store.credential.isLoggedIn(),
      musicid: store.credential.musicid || null,
      upstreamV2: { url: config.upstreamV2, healthy },
    });
  });

  return router;
}

// ==================== 路由: /admin/tokens ====================

function tokenRouter({ helpers, tokenStore }) {
  const router = new Router({ prefix: "/admin/tokens" });

  router.get("/", async (ctx) => {
    ctx.body = helpers.ok({ tokens: tokenStore.list() });
  });

  router.post("/", async (ctx) => {
    const body = ctx.request.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) ctx.throw(400, "name 必填");
    ctx.body = helpers.ok({ token: tokenStore.create(name) });
  });

  router.patch("/:id", async (ctx) => {
    const body = ctx.request.body ?? {};
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    const updated = tokenStore.update(ctx.params.id, patch);
    if (!updated) {
      ctx.status = 404;
      ctx.body = helpers.fail(404, "令牌不存在");
      return;
    }
    ctx.body = helpers.ok({ token: updated });
  });

  router.delete("/:id", async (ctx) => {
    const removed = tokenStore.remove(ctx.params.id);
    if (!removed) {
      ctx.status = 404;
      ctx.body = helpers.fail(404, "令牌不存在");
      return;
    }
    ctx.body = helpers.ok({ removed: true });
  });

  router.post("/:id/rotate", async (ctx) => {
    const rotated = tokenStore.rotate(ctx.params.id);
    if (!rotated) {
      ctx.status = 404;
      ctx.body = helpers.fail(404, "令牌不存在");
      return;
    }
    ctx.body = helpers.ok({ token: rotated });
  });

  return router;
}

// ==================== 路由: /admin/stats ====================

function statsRouter({ helpers, tokenStore }) {
  const router = new Router({ prefix: "/admin" });

  router.get("/stats", async (ctx) => {
    ctx.body = helpers.ok({
      days: tokenStore.stats(),
      tokens: tokenStore.list().map((t) => ({
        id: t.id,
        name: t.name,
        callCount: t.callCount ?? 0,
        lastUsedAt: t.lastUsedAt ?? null,
      })),
    });
  });

  return router;
}

// ==================== 路由: /admin/login (复刻项目1 loginRouter) ====================

function loginRouter({ helpers, client, store }) {
  const router = new Router({ prefix: "/admin/login" });

  /** 同步内存凭证与 store (启动时已加载, 这里只保证运行时一致) */
  const syncClient = () => {
    client.credential = store.credential;
  };

  router.get("/status", async (ctx) => {
    const expired = store.credential.musickey
      ? await client.login.checkExpired(store.credential)
      : false;
    ctx.body = helpers.ok({
      loggedIn: store.credential.isLoggedIn(),
      expired,
      musicid: store.credential.musicid || null,
      file: store.path,
    });
  });

  router.get("/credential", async (ctx) => {
    const includeSensitive = String(ctx.query.raw ?? "") === "1";
    ctx.body = helpers.ok({
      credential: store.toSafeJSON(includeSensitive),
      file: store.path,
    });
  });

  router.put("/credential", async (ctx) => {
    const body = ctx.request.body ?? {};
    const saved = await store.replace(body);
    syncClient();
    ctx.body = helpers.ok(saved.toJSON());
  });

  router.delete("/credential", async (ctx) => {
    await store.clear();
    syncClient();
    ctx.body = helpers.ok({ ok: true });
  });

  router.post("/refresh", async (ctx) => {
    const newCred = await client.login.refreshCredential(store.credential);
    await store.replace(newCred);
    syncClient();
    ctx.body = helpers.ok(newCred.toJSON());
  });

  router.post("/logout", async (ctx) => {
    try {
      await client.login.logout(store.credential);
    } catch {
      // 即使服务端登出失败也允许本地清空
    }
    await store.clear();
    syncClient();
    ctx.body = helpers.ok({ ok: true });
  });

  router.post("/qrcode", async (ctx) => {
    const body = ctx.request.body ?? {};
    const typeStr = String(body.type ?? "qq");
    const type =
      typeStr === "wx" ? QrLoginType.WX : typeStr === "mobile" ? QrLoginType.MOBILE : QrLoginType.QQ;
    const qr = await client.login.getQrcode(type);
    ctx.body = helpers.ok({
      type: qr.type,
      mime: qr.mime,
      identifier: qr.identifier,
      // 返回 base64 便于前端展示
      data: qr.data.toString("base64"),
    });
  });

  router.post("/checkQrcode", async (ctx) => {
    const body = ctx.request.body ?? {};
    const identifier = String(body.identifier ?? "");
    const type = String(body.type ?? "qq");
    if (!identifier) ctx.throw(400, "identifier 必填");
    const result = await client.login.checkQrcode({
      identifier,
      type: type === "wx" ? QrLoginType.WX : QrLoginType.QQ,
      data: Buffer.alloc(0),
      mime: "",
    });
    let saved = null;
    if (result.credential) {
      await store.replace(result.credential);
      syncClient();
      saved = result.credential.toJSON();
    }
    // vendor QrLoginEvent 是数字枚举 (DONE:0 SCAN:1 CONF:2 REFUSE:3 TIMEOUT:4 OTHER:-1),
    // 按 API 契约转换为字符串; CAPTCHA/FREQUENCY/SEND 等字符串事件原样透传。
    const QR_EVENT_NAME = { 0: "DONE", 1: "SCAN", 2: "CONF", 3: "REFUSE", 4: "TIMEOUT", "-1": "OTHER" };
    const rawEvent = result.event;
    const event =
      typeof rawEvent === "number" ? (QR_EVENT_NAME[rawEvent] ?? String(rawEvent)) : rawEvent;
    ctx.body = helpers.ok({
      event,
      credential: saved,
    });
  });

  router.post("/sendAuthcode", async (ctx) => {
    const body = ctx.request.body ?? {};
    const phone = body.phone;
    const countryCode = Number(body.countryCode ?? 86);
    if (phone === undefined) ctx.throw(400, "phone 必填");
    ctx.body = helpers.ok(await client.login.sendAuthcode(phone, countryCode));
  });

  router.post("/phone", async (ctx) => {
    const body = ctx.request.body ?? {};
    const phone = body.phone;
    const code = String(body.code ?? "");
    if (phone === undefined || !code) ctx.throw(400, "phone 和 code 必填");
    const cred = await client.login.phoneAuthorize(phone, code);
    await store.replace(cred);
    syncClient();
    ctx.body = helpers.ok(cred.toJSON());
  });

  return router;
}

// ==================== 组装 ====================

/**
 * 创建管理路由 (Koa Router 实例, 前缀 /admin).
 * @param {{
 *   config: object,
 *   helpers: object,
 *   client: object,
 *   store: import("./core.js").CredentialStore,
 *   tokenStore: import("../tokenStore.js").TokenStore,
 * }} deps
 */
export function createAdminRouter({ config, helpers, client, store, tokenStore }) {
  const deps = { config, helpers, client, store, tokenStore };
  const router = new Router();
  router.use(statusRouter(deps).routes());
  router.use(tokenRouter(deps).routes());
  router.use(statsRouter(deps).routes());
  router.use(loginRouter(deps).routes());
  return router;
}

export default createAdminRouter;
