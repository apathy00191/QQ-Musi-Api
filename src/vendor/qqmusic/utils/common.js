/**
 * 通用工具函数.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

/** 拼接多段字符串/字节计算 MD5 */
export function calcMd5(...parts) {
  const hash = createHash("md5");
  for (const item of parts) {
    if (typeof item === "string") hash.update(item);
    else hash.update(item);
  }
  return hash.digest("hex");
}

/** 生成 32 位随机 GUID */
export function getGuid() {
  return randomUUID().replace(/-/g, "");
}

/**
 * Hash33 算法.
 * h = (h << 5) + h + ord(c)
 */
export function hash33(s, h = 0) {
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 2147483647 & h;
}

/**
 * 生成 searchID.
 */
export function getSearchId() {
  const e = Math.floor(Math.random() * 20) + 1;
  const t = e * 18014398509481984;
  const n = Math.floor(Math.random() * 4194304) * 4294967296;
  const r = Math.round(Date.now()) % (24 * 60 * 60 * 1000);
  return String(t + n + r);
}

/**
 * 递归将数据结构中的布尔值转为 0/1.
 */
export function boolToInt(data) {
  if (typeof data === "boolean") return data ? 1 : 0;
  if (Array.isArray(data)) {
    let changed = false;
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = boolToInt(data[i]);
      if (v !== data[i]) changed = true;
      out[i] = v;
    }
    return changed ? out : data;
  }
  if (data && typeof data === "object") {
    const obj = data;
    const out = {};
    let changed = false;
    for (const k of Object.keys(obj)) {
      const v = boolToInt(obj[k]);
      if (v !== obj[k]) changed = true;
      out[k] = v;
    }
    return changed ? out : data;
  }
  return data;
}

/** 生成 N 字节随机十六进制 */
export function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

/** 随机整数 [min, max] */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
