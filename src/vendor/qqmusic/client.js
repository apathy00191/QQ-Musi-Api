/**
 * API 客户端核心.
 *
 * - 使用 undici 做 HTTP 客户端
 */

import { Agent, request as undiciRequest } from "undici";
import { Credential } from "./models/credential.js";
import { Platform, DEFAULT_VERSION_POLICY, VersionPolicy } from "./versioning.js";
import { DeviceManager } from "./utils/device.js";
import { QimeiManager, _internal as qimeiInternal } from "./utils/qimei.js";
import { zzcSign } from "./algorithms/sign.js";
import { boolToInt } from "./utils/common.js";
import {
  ApiDataError,
  CgiApiException,
  CredentialExpiredError,
  GlobalApiError,
  HTTPError,
  NetworkError,
  RatelimitedError,
  SignatureRequiredError,
} from "./exceptions.js";
import { SongApi } from "./modules/song.js";
import { SearchApi } from "./modules/search.js";
import { UserApi } from "./modules/user.js";
import { LoginApi } from "./modules/login.js";

const MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const MUSICS_URL = "https://u.y.qq.com/cgi-bin/musics.fcg";

export class Client {
  constructor(options = {}) {
    this.credential = new Credential(options.credential);
    this.platform = options.platform ?? Platform.ANDROID;
    this._deviceStore = new DeviceManager(options.devicePath);
    this._versionPolicy = DEFAULT_VERSION_POLICY;
    this._qimeiManager = new QimeiManager({
      appVersion: this._versionPolicy.getQimeiAppVersion(),
      sdkVersion: this._versionPolicy.getQimeiSdkVersion(),
    });
    this._sessionEnsured = false;
    this._sessionEnsuring = null;

    // 业务模块 (懒加载, 触发首次访问时再实例化)
    this._song = null;
    this._search = null;
    this._user = null;
    this._login = null;

    // 注入实际注册实现 (走 undici)
    this._qimeiManager.setRegisterHook(async (device, appVersion, sdkVersion) => {
      const { headers, body } = qimeiInternal.buildQimeiRequest(device, appVersion, sdkVersion);
      const resp = await this.request("POST", "https://api.tencentmusic.com/tme/trpc/proxy", null, null, {
        json: body,
        headers,
        responseType: "json",
      });
      if (resp.statusCode !== 200) {
        throw new Error(`QIMEI 注册失败: HTTP ${resp.statusCode}`);
      }
      const data = resp.data;
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
      // 落盘
      await this._deviceStore.applyQimei(inner.q16, inner.q36);
      return { q16: inner.q16, q36: inner.q36 };
    });
    this._agent = new Agent({
      bodyTimeout: 30_000,
      headersTimeout: 30_000,
      connectTimeout: 10_000,
    });
  }

  get song() {
    if (!this._song) this._song = new SongApi(this);
    return this._song;
  }
  get search() {
    if (!this._search) this._search = new SearchApi(this);
    return this._search;
  }
  get user() {
    if (!this._user) this._user = new UserApi(this);
    return this._user;
  }
  get login() {
    if (!this._login) this._login = new LoginApi(this);
    return this._login;
  }

  /** 关闭底层连接池 */
  async close() {
    await this._agent.close();
  }

  // ==================== 设备/UA ====================

  async getDevice() {
    return this._deviceStore.getDevice();
  }

  async getUserAgent(platform) {
    const p = platform ?? this.platform;
    return this._versionPolicy.getUserAgent(p, await this._deviceStore.getDevice());
  }

  // ==================== 底层 HTTP ====================

  /**
   * 发送普通 HTTP 请求. 自动注入 User-Agent 和 Cookies.
   */
  async request(method, url, credential = null, platform = null, options = {}) {
    const cred =
      credential instanceof Credential
        ? credential
        : credential
          ? new Credential(credential)
          : this.credential;
    const platformUsed = platform ?? this.platform;

    const cookies = { ...(options.cookies ?? {}) };
    if (cred.musicid) {
      const id = cred.strMusicid || String(cred.musicid);
      cookies.uin = id;
      cookies.qqmusic_uin = id;
    }
    if (cred.musickey) {
      cookies.qm_keyst = cred.musickey;
      cookies.qqmusic_key = cred.musickey;
    }
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    const headers = { ...(options.headers ?? {}) };
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    if (!headers["User-Agent"]) headers["User-Agent"] = await this.getUserAgent(platformUsed);

    let body;
    let contentType;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      contentType = "application/json";
    } else if (options.body !== undefined) {
      body = options.body;
    }
    if (contentType) headers["Content-Type"] = contentType;

    try {
      const res = await undiciRequest(url, {
        method,
        headers,
        body,
        query: options.params,
        dispatcher: this._agent,
        bodyTimeout: options.timeoutMs ?? 30_000,
        headersTimeout: options.timeoutMs ?? 30_000,
        maxRedirections: options.allowRedirects === false ? 0 : 5,
      });
      const buf = Buffer.from(await res.body.arrayBuffer());
      const text = buf.toString("utf-8");
      let data = text;
      // QQ 业务接口很多响应不带 application/json, 直接看 body 头是否是 { 开头更稳
      const ct = String(res.headers["content-type"] ?? "").toLowerCase();
      const looksJson =
        options.responseType === "json" ||
        ct.includes("json") ||
        /^\s*[\{\[]/.test(text);
      if (looksJson) {
        try {
          data = JSON.parse(text);
        } catch {
          // 保留原始文本
          data = text;
        }
      } else if (options.responseType === "arrayBuffer") {
        data = buf;
      }
      return {
        statusCode: res.statusCode,
        headers: res.headers,
        cookies: parseSetCookies(res.headers),
        text,
        data,
        content: buf,
      };
    } catch (e) {
      throw new NetworkError(`网络错误: ${e.message}`, { cause: e });
    }
  }

  // ==================== 业务 API 请求 ====================

  /**
   * 发送 cgi-bin API 请求.
   */
  async requestApi(data, options = {}) {
    const platform = options.isJce
      ? Platform.ANDROID
      : (options.platform ?? this.platform);

    if (platform === Platform.ANDROID) await this._ensureSession();
    const device = await this._deviceStore.getDevice();

    let comm;
    if (options.overrideComm) {
      comm = { ...(options.comm ?? {}) };
    } else {
      comm = this._versionPolicy.buildComm(
        platform,
        options.credential ?? this.credential,
        device,
        platform === Platform.ANDROID ? await this._qimeiManager.getCached(device) : null,
        device.openUdid,
      );
      if (options.comm) Object.assign(comm, options.comm);
    }

    const cred = options.credential ?? this.credential;
    const userAgent = await this.getUserAgent(platform);

    if (options.isJce) {
      throw new Error("JCE/Tarsio 二进制协议暂未实现, 请使用 JSON 协议");
    }

    const payload = { comm };
    for (let idx = 0; idx < data.length; idx++) {
      const req = data[idx];
      const param = req.preserveBool ? req.param : boolToInt(req.param);
      payload[`req_${idx}`] = { module: req.module, method: req.method, param };
    }

    const query = {};
    if (options.sign) {
      query["_"] = String(Date.now());
      query["sign"] = zzcSign(JSON.stringify(payload));
    }

    const url = options.sign ? MUSICS_URL : MUSICU_URL;
    return this.request("POST", url, cred, platform, {
      json: payload,
      params: query,
      headers: { "User-Agent": userAgent },
    });
  }

  /**
   * 执行单个 Request 描述符并解析响应.
   */
  async execute(request) {
    const resp = await this.requestApi(
      [
        {
          module: request.module,
          method: request.method,
          param: request.param,
          preserveBool: request.preserveBool,
        },
      ],
      {
        comm: request.comm,
        overrideComm: request.overrideComm,
        credential: request.credential,
        platform: request.platform,
        isJce: request.isJce,
        sign: request.sign,
      },
    );
    const data = this._validateResponse(resp);
    return this._parseCgiItem(data.req_0, request);
  }

  /**
   * 批量执行多个 Request. 简化实现: 串行收集结果(原项目有分组批处理优化).
   */
  async gather(requests) {
    const out = [];
    for (const req of requests) {
      out.push(await this.execute(req));
    }
    return out;
  }

  // ==================== 内部 ====================

  _validateResponse(resp) {
    if (resp.statusCode !== 200) {
      throw new HTTPError(`HTTP ${resp.statusCode}`, { statusCode: resp.statusCode, data: resp.text });
    }
    if (!resp.text) throw new ApiDataError("响应为空");
    let json;
    try {
      json = typeof resp.data === "object" && resp.data !== null
        ? resp.data
        : JSON.parse(resp.text);
    } catch {
      throw new ApiDataError("响应不是有效 JSON");
    }
    const code = json.code ?? 0;
    if (code !== 0) {
      throw new GlobalApiError("模块返回异常", { code, data: resp.text });
    }
    return json;
  }

  _parseCgiItem(item, request) {
    const code = item?.code ?? 0;
    const data = item?.data ?? {};
    if (request.allowErrorCodes) {
      const allowed =
        request.allowErrorCodes === "all" ||
        (Array.isArray(request.allowErrorCodes)
          ? request.allowErrorCodes.includes(code)
          : request.allowErrorCodes.has(code));
      if (code === 0 || allowed) {
        if (request.parseOnAllow && request.responseModel) {
          return new request.responseModel(data);
        }
        return data;
      }
    }
    switch (code) {
      case 2000:
        throw new SignatureRequiredError("需要签名", { code, data });
      case 2001:
        throw new RatelimitedError("请求被限流", { code, data });
      case 1000:
      case 104401:
      case 104400:
        throw new CredentialExpiredError("凭证已过期", { code, data });
      case 0:
        break;
      default:
        throw new CgiApiException("业务返回非零码", { code, data });
    }
    if (request.responseModel) {
      return new request.responseModel(data);
    }
    return data;
  }

  async _ensureSession() {
    if (this._sessionEnsured) return;
    if (this._sessionEnsuring) return this._sessionEnsuring;
    this._sessionEnsuring = this._doEnsureSession();
    try {
      await this._sessionEnsuring;
    } finally {
      this._sessionEnsuring = null;
    }
  }

  async _doEnsureSession() {
    const device = await this._deviceStore.getDevice();
    if (this._isSessionValid(device)) {
      this._sessionEnsured = true;
      return;
    }
    const comm = this._versionPolicy.buildComm(
      Platform.ANDROID,
      this.credential,
      device,
      await this._qimeiManager.getCached(device),
      device.openUdid,
    );
    const payload = {
      comm,
      req_0: {
        module: "music.getSession.session",
        method: "GetSession",
        param: { uid: device.sessionUid || "", vkey: 0, caller: 0 },
      },
    };
    const userAgent = await this.getUserAgent(Platform.ANDROID);
    const resp = await this.request("POST", MUSICU_URL, this.credential, Platform.ANDROID, {
      json: payload,
      headers: { "User-Agent": userAgent },
    });
    if (resp.statusCode !== 200) {
      throw new HTTPError(`HTTP ${resp.statusCode}`, { statusCode: resp.statusCode });
    }
    let data = resp.data;
    // 兜底: 若 data 仍是字符串, 主动解析一次
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        /* ignore */
      }
    }
    const req0 = data?.req_0;
    const session = req0?.data?.session;
    if (!session) {
      const body = resp.text.slice(0, 300).replace(/\s+/g, " ");
      console.error(
        `[qqmusic-api] getSession 失败: status=${resp.statusCode} ` +
          `req0.code=${req0?.code} body=${body}`,
      );
      throw new ApiDataError(
        `获取 session 失败 (req0.code=${req0?.code ?? "?"}, body=${body})`,
      );
    }
    device.sessionUid = String(session.uid);
    device.sessionSid = session.sid;
    device.sessionVkey = session.vkey;
    device.sessionSaveTime = Math.floor(Date.now() / 1000);
    await this._deviceStore.save();
    this._sessionEnsured = true;
  }

  _isSessionValid(d) {
    if (!d.sessionSaveTime) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - d.sessionSaveTime >= 86400) return false;
    return Boolean(d.sessionUid && d.sessionSid);
  }
}

function parseSetCookies(headers) {
  const out = {};
  // undici v6+ 提供 getSetCookie() 直接返回所有 Set-Cookie
  const list =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const raw = headers["set-cookie"];
          if (!raw) return [];
          if (Array.isArray(raw)) return raw;
          return raw.split(/\n/);
        })();
  for (const c of list) {
    const first = c.split(";")[0];
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    // QQ 习惯在真值后再发一条 "name=;Expires=1970..." 来在另一个域上清除该 cookie
    // 这种删除指令的 value 是空串, 直接跳过以避免覆盖真值
    if (!value) continue;
    out[name] = value;
  }
  return out;
}
