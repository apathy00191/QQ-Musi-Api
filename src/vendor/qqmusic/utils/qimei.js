/**
 * QIMEI 管理.
 *
 * QQ 音乐的业务接口在 Android 平台会校验 QIMEI, 必须先在
 * `https://api.tencentmusic.com/tme/trpc/proxy` 上报设备指纹
 * 并换取服务端签发的 q16/q36, 否则会被风控直接拒绝 (表现是
 * "获取 session 失败").
 *
 * 本实现严格 1:1 移植自原项目.
 * - 随机 beaconId 由设备指纹生成
 * - crypt_key 用 RSA-PKCS1v15 加密, payload 用 AES-CBC 加密
 * - sign 用 MD5(key, params, ts*1000, nonce, SECRET, extra)
 */

import { createCipheriv, publicEncrypt, randomBytes } from "node:crypto";
import { calcMd5 } from "./common.js";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKpqLQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y6B9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----`;
const SECRET = "ZdJqM15EeO2zWc08";
const APP_KEY = "0AND0HD6FE4HY80F";
const CHANNEL_ID = "10003505";
const PACKAGE_ID = "com.tencent.qqmusic";
const QIMEI_HOST = "https://api.tencentmusic.com/tme/trpc/proxy";
const HEX_CHARS = "0123456789abcdef";

function rsaEncrypt(content) {
  return publicEncrypt(
    {
      key: PUBLIC_KEY,
      padding: 1, // RSA_PKCS1_PADDING
    },
    content,
  );
}

function aesEncrypt(key, content) {
  const paddingSize = 16 - (content.length % 16);
  const padded = Buffer.concat([content, Buffer.alloc(paddingSize, paddingSize)]);
  const cipher = createCipheriv("aes-128-cbc", key, key);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomHex(n) {
  return randomBytes(n).toString("hex").slice(0, n);
}

function randomHexNonZero(n) {
  const chars = HEX_CHARS.slice(1);
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** 生成 40 段 beaconId. */
function randomBeaconId() {
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const rand1 = randomInt(100000, 999999);
  const rand2 = randomInt(100000000, 999999999);
  const parts = [];
  const k1Set = new Set([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38]);
  for (let i = 1; i <= 40; i++) {
    if (k1Set.has(i)) {
      parts.push(`k${i}:${monthStart}${rand1}.${rand2}`);
    } else if (i === 3) {
      parts.push("k3:0000000000000000");
    } else if (i === 4) {
      parts.push(`k4:${randomHexNonZero(16)}`);
    } else {
      parts.push(`k${i}:${randomInt(0, 9999)}`);
    }
    parts.push(";");
  }
  return parts.join("");
}

function buildPayload(device, version, sdkVersion) {
  const fixedRand = randomInt(0, 14400);
  const now = new Date();
  const upTime = new Date(now.getTime() - fixedRand * 1000);
  const upTimeStr = upTime
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const reserved = {
    harmony: "0",
    clone: "0",
    containe: "",
    oz: "UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=",
    oo: "Xecjt+9S1+f8Pz2VLSxgpw==",
    kelong: "0",
    uptimes: upTimeStr,
    multiUser: "0",
    bod: device.brand,
    dv: device.device,
    firstLevel: "",
    manufact: device.brand,
    name: device.model,
    host: "se.infra",
    kernel: device.procVersion,
  };
  return {
    androidId: device.androidId,
    platformId: 1,
    appKey: APP_KEY,
    appVersion: version,
    beaconIdSrc: randomBeaconId(),
    brand: device.brand,
    channelId: CHANNEL_ID,
    cid: "",
    imei: device.imei,
    imsi: "",
    mac: "",
    model: device.model,
    networkType: "unknown",
    oaid: "",
    osVersion: `Android ${device.version.release},level ${device.version.sdk}`,
    qimei: "",
    qimei36: "",
    sdkVersion,
    targetSdkVersion: "33",
    audit: "",
    userId: "{}",
    packageId: PACKAGE_ID,
    deviceType: "Phone",
    sdkName: "",
    reserved: JSON.stringify(reserved),
  };
}

function buildQimeiRequest(device, version, sdkVersion) {
  const payload = buildPayload(device, version, sdkVersion);
  const cryptKey = randomHex(16);
  const nonce = randomHex(16);
  const ts = Math.floor(Date.now() / 1000);

  const key = rsaEncrypt(Buffer.from(cryptKey, "utf-8")).toString("base64");
  const params = aesEncrypt(
    Buffer.from(cryptKey, "utf-8"),
    Buffer.from(JSON.stringify(payload), "utf-8"),
  ).toString("base64");
  const extra = `{"appKey":"${APP_KEY}"}`;
  const reqSign = calcMd5(
    key,
    params,
    String(ts * 1000),
    nonce,
    SECRET,
    extra,
  );

  const headers = {
    Host: "api.tencentmusic.com",
    method: "GetQimei",
    service: "trpc.tme_datasvr.qimeiproxy.QimeiProxy",
    appid: "qimei_qq_android",
    sign: calcMd5("qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH", String(ts)),
    "user-agent": "QQMusic",
    timestamp: String(ts),
    "Content-Type": "application/json",
  };

  const body = {
    app: 0,
    os: 1,
    qimeiParams: {
      key,
      params,
      time: String(ts),
      nonce,
      sign: reqSign,
      extra,
    },
  };
  return { ts, headers, body };
}

/** 内部: 发起一次 QIMEI 注册 HTTP. */
async function doRequestQimei(device, appVersion, sdkVersion, doRequest) {
  const { headers, body } = buildQimeiRequest(device, appVersion, sdkVersion);
  const resp = await doRequest(QIMEI_HOST, headers, body);
  if (resp.status !== 200) {
    throw new Error(`QIMEI 注册失败: HTTP ${resp.status}`);
  }
  const data = resp.json;
  let inner;
  if (typeof data?.data === "string") {
    try {
      const parsed = JSON.parse(data.data);
      inner = parsed.data;
    } catch {
      throw new Error("QIMEI 响应 data 字段不是 JSON");
    }
  } else if (data && typeof data.data === "object" && data.data !== null) {
    inner = data.data.data;
  }
  if (!inner || !inner.q16 || !inner.q36) {
    throw new Error("QIMEI 响应缺少 q16/q36 字段");
  }
  return { q16: inner.q16, q36: inner.q36 };
}

/**
 * QIMEI 管理器.
 *
 * 优先使用设备文件中的缓存; 缓存过期或缺失时调用
 * `https://api.tencentmusic.com/tme/trpc/proxy` 注册.
 */
export class QimeiManager {
  constructor(opts = {}) {
    this._cache = null;
    this._lock = Promise.resolve();
    this._appVersion = opts.appVersion ?? "14.9.0.8";
    this._sdkVersion = opts.sdkVersion ?? "1.2.13.6";
    this._registerHook =
      opts.registerHook ??
      (async () => {
        throw new Error("QimeiManager 未注入 registerHook (应在 Client 构造时设置)");
      });
  }

  /** 注入自定义注册实现 (通常由 Client 在拿到 undici request 后注入) */
  setRegisterHook(hook) {
    this._registerHook = hook;
  }

  setVersions(appVersion, sdkVersion) {
    this._appVersion = appVersion;
    this._sdkVersion = sdkVersion;
  }

  /** 内部: 取 q16/q36 (使用缓存或注册) */
  async getCached(device) {
    if (this._cache) return this._cache;
    const now = Math.floor(Date.now() / 1000);
    if (
      device.qimei &&
      device.qimei36 &&
      device.qimeiSaveTime &&
      now - device.qimeiSaveTime < 86400
    ) {
      this._cache = { q16: device.qimei, q36: device.qimei36 };
      return this._cache;
    }
    // 串行化注册 (同一时刻只调一次)
    this._lock = this._lock.then(() => this._doRegister(device));
    await this._lock;
    return this._cache;
  }

  async _doRegister(device) {
    const result = await this._registerHook(device, this._appVersion, this._sdkVersion);
    this._cache = result;
  }
}

// 重新导出工具函数 (供测试或外部使用)
export const _internal = {
  rsaEncrypt,
  aesEncrypt,
  buildQimeiRequest,
  doRequestQimei,
};
