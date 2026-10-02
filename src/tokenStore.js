/**
 * Bearer Token 存储.
 *
 * - DATA_DIR/tokens.json: 令牌记录 (原子写 tmp+rename + 串行写队列)
 * - DATA_DIR/stats.json : 按日期调用统计 { "YYYY-MM-DD": { total, byToken } }
 *
 * 记录字段: { id, name, token, enabled, createdAt, updatedAt, lastUsedAt, callCount }
 * token 值形如 qmg_ + crypto.randomBytes(24).toString("hex")
 */

import { randomBytes, randomUUID } from "node:crypto";

import { atomicWriteJson, readJsonFile, timingSafeEqualStr } from "./helpers.js";

const TOKEN_PREFIX = "qmg_";

function nowISO() {
  return new Date().toISOString();
}

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class TokenStore {
  /**
   * @param {{ tokensPath: string, statsPath: string }} options
   */
  constructor(options) {
    this.tokensPath = options.tokensPath;
    this.statsPath = options.statsPath;
    this._tokens = readJsonFile(this.tokensPath, []);
    if (!Array.isArray(this._tokens)) this._tokens = [];
    this._stats = readJsonFile(this.statsPath, {});
    if (!this._stats || typeof this._stats !== "object") this._stats = {};
    // 串行写队列 (tokens 与 stats 共用, 保证落盘顺序)
    this._writeQueue = Promise.resolve();
  }

  // ==================== 令牌 CRUD ====================

  /** 全部令牌记录 */
  list() {
    return this._tokens.slice();
  }

  /** 按 id 查找 */
  get(id) {
    return this._tokens.find((t) => t.id === id) ?? null;
  }

  /** 创建令牌, 返回完整记录 (含明文 token) */
  create(name) {
    const ts = nowISO();
    const record = {
      id: randomUUID(),
      name: String(name || "未命名").slice(0, 64),
      token: TOKEN_PREFIX + randomBytes(24).toString("hex"),
      enabled: true,
      createdAt: ts,
      updatedAt: ts,
      lastUsedAt: null,
      callCount: 0,
    };
    this._tokens.push(record);
    this._saveTokens();
    return { ...record };
  }

  /** 局部更新 (支持 name / enabled), 返回更新后记录或 null */
  update(id, patch = {}) {
    const rec = this.get(id);
    if (!rec) return null;
    if (patch.name !== undefined) rec.name = String(patch.name).slice(0, 64);
    if (patch.enabled !== undefined) rec.enabled = Boolean(patch.enabled);
    rec.updatedAt = nowISO();
    this._saveTokens();
    return { ...rec };
  }

  /** 删除令牌, 返回是否删除 */
  remove(id) {
    const idx = this._tokens.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    this._tokens.splice(idx, 1);
    this._saveTokens();
    return true;
  }

  /** 轮换令牌值 (保留 id/统计), 返回更新后记录或 null */
  rotate(id) {
    const rec = this.get(id);
    if (!rec) return null;
    rec.token = TOKEN_PREFIX + randomBytes(24).toString("hex");
    rec.updatedAt = nowISO();
    this._saveTokens();
    return { ...rec };
  }

  // ==================== 校验与计数 ====================

  /**
   * 校验令牌值: 必须存在且 enabled=true.
   * 逐条做恒定时间比较, 返回记录引用或 null.
   */
  verify(value) {
    if (!value || typeof value !== "string") return null;
    let found = null;
    // 全量比较 (不提前 break) 以降低时序侧信道
    for (const rec of this._tokens) {
      if (timingSafeEqualStr(rec.token, value) && rec.enabled && !found) {
        found = rec;
      }
    }
    return found;
  }

  /**
   * 命中计数: callCount++ / lastUsedAt / 当日统计落盘.
   * @returns {object|null} 更新后的记录
   */
  hit(id) {
    const rec = this.get(id);
    if (!rec) return null;
    rec.callCount = (rec.callCount ?? 0) + 1;
    rec.lastUsedAt = nowISO();

    const day = todayKey();
    const bucket = this._stats[day] ?? { total: 0, byToken: {} };
    bucket.total = (bucket.total ?? 0) + 1;
    bucket.byToken = bucket.byToken ?? {};
    bucket.byToken[id] = (bucket.byToken[id] ?? 0) + 1;
    this._stats[day] = bucket;

    this._saveTokens();
    this._saveStats();
    return rec;
  }

  /** 全部按日统计 */
  stats() {
    return this._stats;
  }

  /** 汇总: 启用数量等 */
  summary() {
    const enabled = this._tokens.filter((t) => t.enabled).length;
    return { total: this._tokens.length, enabled };
  }

  // ==================== 落盘 ====================

  _saveTokens() {
    this._enqueue(() => atomicWriteJson(this.tokensPath, this._tokens));
  }

  _saveStats() {
    this._enqueue(() => atomicWriteJson(this.statsPath, this._stats));
  }

  /** 串行写队列: 后一次写排队在前一次之后 */
  _enqueue(fn) {
    this._writeQueue = this._writeQueue.then(() => fn()).catch((e) => {
      console.error("[QQMusicApi] tokenStore 落盘失败:", e);
    });
    return this._writeQueue;
  }

  /** 等待挂起的写操作完成 (测试/优雅退出用) */
  flush() {
    return this._writeQueue;
  }
}

export default TokenStore;
