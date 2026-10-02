/**
 * 核心业务路由 (前缀 /api/v1, 需要 Bearer token).
 *
 * 逻辑照抄项目1 `音乐解析api/src/server.js` 的 searchRouter / songRouter / userRouter,
 * 仅调整前缀; 凭证存储 CredentialStore 亦复制自项目1 (路径改用 config.credentialPath).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Router from "@koa/router";

import { Client } from "../vendor/qqmusic/client.js";
import { Credential } from "../vendor/qqmusic/models/credential.js";
import { SearchType } from "../vendor/qqmusic/modules/search.js";
import { parseSongFileType } from "../vendor/qqmusic/modules/song_filetype.js";
import { qrcDecrypt } from "../vendor/qqmusic/algorithms/qrc.js";

// ==================== 凭证存储 (复制自项目1 server.js) ====================

/**
 * 凭证文件存储.
 * 启动时从文件加载凭证,后续每次更新都原子写入磁盘.
 * 文件格式: JSON, 与 Credential.toJSON() 输出一致.
 */
export class CredentialStore {
  constructor(options = {}) {
    this._path = options.path
      ? isAbsolute(options.path)
        ? options.path
        : resolve(options.path)
      : resolve("./credential.json");
    this._credential = this._load();
    this._writeQueue = Promise.resolve();
  }

  /** 当前凭证的引用(外部修改不会自动落盘, 请使用 replace) */
  get credential() {
    return this._credential;
  }

  /** 凭证文件路径 */
  get path() {
    return this._path;
  }

  /** 替换当前凭证并原子写入文件 */
  async replace(credential) {
    const next = credential instanceof Credential ? credential : new Credential(credential);
    this._credential = next;
    await this._persist();
    return next;
  }

  /** 与现有凭证合并并写入 */
  async merge(patch) {
    const merged = new Credential({ ...this._credential.toJSON(), ...patch });
    this._credential = merged;
    await this._persist();
    return merged;
  }

  /** 清空凭证 (仅清除 musickey/musicid, 保留 device) */
  async clear() {
    this._credential = new Credential();
    await this._persist();
  }

  /** 返回脱敏后的凭证(用于前端展示,隐藏 musickey/openid 等敏感字段) */
  toSafeJSON(includeSensitive = false) {
    const raw = this._credential.toJSON();
    if (includeSensitive) return raw;
    const safe = {};
    for (const [k, v] of Object.entries(raw)) {
      if (this._isSensitive(k)) {
        safe[k] = v ? "***" : "";
      } else {
        safe[k] = v;
      }
    }
    return safe;
  }

  _isSensitive(key) {
    return [
      "musickey",
      "openid",
      "unionid",
      "accessToken",
      "refreshToken",
      "refreshKey",
      "encryptUin",
    ].includes(key);
  }

  _load() {
    if (!existsSync(this._path)) return new Credential();
    try {
      const raw = JSON.parse(readFileSync(this._path, "utf-8"));
      return new Credential(raw);
    } catch {
      return new Credential();
    }
  }

  async _persist() {
    // 串行化写操作, 避免并发覆盖
    this._writeQueue = this._writeQueue.then(() => this._doWrite());
    await this._writeQueue;
  }

  _doWrite() {
    return new Promise((resolvePromise, reject) => {
      try {
        const dir = dirname(this._path);
        if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
        const tmp = `${this._path}.tmp`;
        const json = JSON.stringify(this._credential.toJSON(), null, 2);
        writeFileSync(tmp, json, "utf-8");
        renameSync(tmp, this._path);
        resolvePromise();
      } catch (e) {
        reject(e);
      }
    });
  }
}

// ==================== 运行时 (Client + 凭证) ====================

/**
 * 创建共享运行时: 凭证存储优先于 Client 初始化 (Client 直接持有 store 内凭证).
 * server.js 只创建一次, 同时注入 core 与 admin 路由.
 */
export function createRuntime(config) {
  const store = new CredentialStore({ path: config.credentialPath });
  const client = new Client({
    platform: config.platform,
    devicePath: config.devicePath,
    credential: store.credential.toJSON(),
  });
  return { store, client };
}

// ==================== 路由: /api/v1/search ====================

function searchRouter(client, ok) {
  const router = new Router({ prefix: "/api/v1/search" });

  router.get("/hotkey", async (ctx) => {
    ctx.body = ok(await client.search.getHotkey());
  });

  router.get("/complete", async (ctx) => {
    const keyword = String(ctx.query.keyword ?? "");
    if (!keyword) ctx.throw(400, "keyword 必填");
    ctx.body = ok(await client.search.complete(keyword));
  });

  router.get("/quick", async (ctx) => {
    const keyword = String(ctx.query.keyword ?? "");
    if (!keyword) ctx.throw(400, "keyword 必填");
    ctx.body = ok(await client.search.quickSearch(keyword));
  });

  router.post("/general", async (ctx) => {
    const body = ctx.request.body ?? {};
    const { keyword, page, num, searchid, pageStart, highlight } = body;
    if (!keyword) ctx.throw(400, "keyword 必填");
    ctx.body = ok(
      await client.search.generalSearch(
        keyword,
        page ?? 1,
        num ?? 15,
        searchid ?? null,
        pageStart ?? null,
        highlight ?? true,
      ),
    );
  });

  router.post("/byType", async (ctx) => {
    const body = ctx.request.body ?? {};
    const { keyword, type, num, page, searchid, highlight } = body;
    if (!keyword) ctx.throw(400, "keyword 必填");
    ctx.body = ok(
      await client.search.searchByType(
        keyword,
        type ?? SearchType.SONG,
        num ?? 10,
        page ?? 1,
        searchid ?? null,
        highlight ?? true,
      ),
    );
  });

  return router;
}

// ==================== 路由: /api/v1/song ====================

function songRouter(client, ok) {
  const router = new Router({ prefix: "/api/v1/song" });

  router.get("/detail", async (ctx) => {
    const mids = String(ctx.query.mids ?? "").split(",").filter(Boolean);
    if (mids.length === 0) ctx.throw(400, "mids 必填");
    ctx.body = ok(await client.song.getDetail(mids));
  });

  router.get("/urls", async (ctx) => {
    const mids = String(ctx.query.mids ?? "").split(",").filter(Boolean);
    if (mids.length === 0) ctx.throw(400, "mids 必填");
    const typeStr = String(ctx.query.type ?? "MP3_128");
    const fileType = parseSongFileType(typeStr) ?? typeStr;
    ctx.body = ok(await client.song.getPlayUrls(mids, fileType));
  });

  router.get("/lyric", async (ctx) => {
    const mid = String(ctx.query.mid ?? "");
    if (!mid) ctx.throw(400, "mid 必填");
    const wantDecode = String(ctx.query.decode ?? "1") !== "0";
    const data = await client.song.getLyrics(mid, { trans: true, roma: false, qrc: true });
    const out = { raw: data };
    if (wantDecode) {
      try {
        if (data.crypt === 1) {
          if (data.lyric) out.lyric = qrcDecrypt(data.lyric);
          if (data.trans) out.trans = qrcDecrypt(data.trans);
          if (data.roma) out.roma = qrcDecrypt(data.roma);
        } else {
          // 后端未加密, 直接透传
          out.lyric = data.lyric ?? "";
          out.trans = data.trans ?? "";
          out.roma = data.roma ?? "";
        }
      } catch (e) {
        out.decodeError = `QRC 解密失败: ${e.message}`;
      }
    }
    ctx.body = ok(out);
  });

  router.get("/similar", async (ctx) => {
    const songid = ctx.query.songid ?? ctx.query.id;
    if (!songid) ctx.throw(400, "songid 必填 (数字歌曲 ID)");
    const data = await client.song.getSimilar(String(songid));
    // 展开: 把 [group.songs[].track] 展平成一维数组
    const list = [];
    for (const group of data?.vecSongNew ?? []) {
      for (const entry of group.songs ?? []) {
        if (entry?.track) list.push(entry.track);
      }
    }
    ctx.body = ok({ list, groups: data?.vecSongNew ?? [] });
  });

  router.get("/relatedSonglist", async (ctx) => {
    const mid = String(ctx.query.mid ?? "");
    if (!mid) ctx.throw(400, "mid 必填");
    ctx.body = ok(await client.song.getRelatedSonglist(mid));
  });

  return router;
}

// ==================== 路由: /api/v1/user ====================

function userRouter(client, ok) {
  const router = new Router({ prefix: "/api/v1/user" });

  router.get("/self", async (ctx) => {
    ctx.body = ok(await client.user.getSelfInfo());
  });

  router.get("/info", async (ctx) => {
    const uin = String(ctx.query.uin ?? "");
    if (!uin) ctx.throw(400, "uin 必填");
    ctx.body = ok(await client.user.getUserInfo(uin));
  });

  router.get("/songlist", async (ctx) => {
    const uin = String(ctx.query.uin ?? "");
    if (!uin) ctx.throw(400, "uin 必填");
    const page = Number(ctx.query.page ?? 1);
    const num = Number(ctx.query.num ?? 30);
    ctx.body = ok(await client.user.getUserSonglist(uin, page, num));
  });

  router.get("/follows", async (ctx) => {
    const uin = String(ctx.query.uin ?? "");
    if (!uin) ctx.throw(400, "uin 必填");
    const page = Number(ctx.query.page ?? 1);
    const num = Number(ctx.query.num ?? 30);
    ctx.body = ok(await client.user.getUserFollows(uin, page, num));
  });

  router.get("/fans", async (ctx) => {
    const uin = String(ctx.query.uin ?? "");
    if (!uin) ctx.throw(400, "uin 必填");
    const page = Number(ctx.query.page ?? 1);
    const num = Number(ctx.query.num ?? 30);
    ctx.body = ok(await client.user.getUserFans(uin, page, num));
  });

  router.post("/follow", async (ctx) => {
    const body = ctx.request.body ?? {};
    const uin = String(body.uin ?? "");
    const follow = Boolean(body.follow ?? true);
    if (!uin) ctx.throw(400, "uin 必填");
    ctx.body = ok(await client.user.follow(uin, follow));
  });

  return router;
}

// ==================== 组装 ====================

/**
 * 创建核心路由 (Koa Router 实例, 前缀 /api/v1).
 * @param {{ config: object, helpers: object, client: object, credentialStore: CredentialStore }} deps
 */
export function createCoreRouter({ helpers, client }) {
  const { ok } = helpers;
  const router = new Router();
  router.use(searchRouter(client, ok).routes());
  router.use(songRouter(client, ok).routes());
  router.use(userRouter(client, ok).routes());
  return router;
}

export default createCoreRouter;
