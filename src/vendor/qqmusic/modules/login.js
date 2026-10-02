/**
 * 登录相关 API.
 *
 * MVP 范围:
 * - checkExpired         检查凭证是否过期
 * - refreshCredential    刷新凭证
 * - logout               登出
 * - getQrcode            获取 QQ 登录二维码
 * - checkQrcode          检查二维码状态
 * - sendAuthcode         发送手机验证码
 * - phoneAuthorize       手机验证码登录
 *
 * 未实现:
 * - 微信二维码登录 (需 HTML 解析)
 * - 手机客户端二维码 (依赖 MQTT 长连接, 暂未实现)
 */

import { randomUUID } from "node:crypto";
import { ApiModule } from "./base.js";
import { Credential } from "../models/credential.js";
import { Platform } from "../versioning.js";
import { hash33 } from "../utils/common.js";
import { ApiDataError, CredentialRefreshError, LoginError } from "../exceptions.js";

const LOGIN_ERROR_CODES = new Set([
  1000, 104401, 104400, 20261, 20271, 20272, 20274, 20277, 20278, 20279, 20450, 104604,
]);

const QQ_STATUS_RE = /ptuiCB\((.*?)\)/;
const QQ_ARGS_RE = /'((?:\\.|[^'])*)'/g;
const QQ_SIGX_RE = /(?:\?|&)ptsigx=(.+?)&s_url/;
const QQ_UIN_RE = /(?:\?|&)uin=(.+?)&service/;

export const QrLoginType = {
  QQ: "qq",
  WX: "wx",
  MOBILE: "mobile",
};

export const QrLoginEvent = {
  DONE: 0,
  SCAN: 1,
  CONF: 2,
  REFUSE: 3,
  TIMEOUT: 4,
  OTHER: -1,
};

const EVENT_MAP = {
  0: QrLoginEvent.DONE,
  66: QrLoginEvent.SCAN,
  67: QrLoginEvent.CONF,
  65: QrLoginEvent.REFUSE,
};

function mapEvent(code) {
  return EVENT_MAP[code] ?? QrLoginEvent.OTHER;
}

export class LoginApi extends ApiModule {
  /** 校验并返回 data 字段或抛错
   *  入参可能两种形态:
   *  1. 已解包形态(由 Client.execute 返回): { openid, refresh_token, ... }
   *  2. 原始 CGI 响应: { code, data: {...} }
   *  两种都要正确处理.
   */
  _validateResult(resp) {
    const r = resp ?? {};
    // 形态 1: 已经是 data 字典(没有顶层 code/data 包装)
    if (r.code === undefined && r.data === undefined) {
      return r;
    }
    const code = r.code ?? 0;
    const data = r.data ?? {};
    switch (code) {
      case 0:
        return data;
      case 1000:
      case 104401:
      case 104400:
        throw new LoginError("登录鉴权已过期", { code, data });
      case 20261:
        throw new LoginError("登录参数错误", { code, data });
      case 20271:
        throw new LoginError("验证码错误", { code, data });
      case 20272:
        throw new LoginError("账号绑定异常", { code, data });
      case 20274:
        throw new LoginError("账号绑定缺失", { code, data });
      case 20277:
      case 20278:
        throw new LoginError("账号受限", { code, data });
      case 20279:
        throw new LoginError("登录设备数超限", { code, data });
      case 20450:
        throw new LoginError("账号已被封禁", { code, data });
      case 104604:
        throw new LoginError("操作过于频繁", { code, data });
      default:
        if (LOGIN_ERROR_CODES.has(code)) {
          throw new LoginError(`登录错误: ${code}`, { code, data });
        }
        throw new LoginError(`未知登录错误: ${code}`, { code, data });
    }
  }

  /** 检查凭证是否过期 */
  async checkExpired(credential) {
    const target = credential ?? this._client.credential;
    if (this._client.platform === Platform.WEB) {
      const resp = await this._client.request(
        "GET",
        "https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
        target,
        Platform.WEB,
        {
          params: {
            g_tk: hash33(target.musickey, 5381),
            format: "json",
            inCharset: "utf-8",
            outCharset: "utf-8",
            notice: 0,
            cid: 205360838,
            needNewCode: 0,
            loginUin: target.musicid,
            hostUin: 0,
            userid: target.musicid,
            reqfrom: 1,
          },
        },
      );
      const data = resp.data;
      return data?.code !== 0;
    }
    const data = await this._client.execute(
      this._buildRequest(
        "music.UserInfo.userInfoServer",
        "GetLoginUserInfo",
        {},
        {
          credential: target,
          allowErrorCodes: new Set([1000, 104401, 104400]),
        },
      ),
    );
    return (data.code ?? 0) !== 0;
  }

  /** 刷新登录凭证 */
  async refreshCredential(credential) {
    const target = this._requireLogin(credential);
    let param;
    switch (target.loginType) {
      case 1:
        param = {
          openid: target.openid,
          refresh_token: target.refreshToken,
          str_musicid: target.strMusicid || String(target.musicid),
          musickey: target.musickey,
          unionid: target.unionid,
          refresh_key: target.refreshKey,
          loginMode: 2,
        };
        break;
      case 2:
        param = {
          openid: target.openid,
          access_token: target.accessToken,
          refresh_token: target.refreshToken,
          expired_in: target.expiredAt,
          musicid: target.musicid,
          musickey: target.musickey,
          refresh_key: target.refreshKey,
          loginMode: 2,
        };
        break;
      default:
        param = {
          openid: target.openid,
          access_token: target.accessToken,
          refresh_token: target.refreshToken,
          expired_in: target.expiredAt,
          str_musicid: target.strMusicid || String(target.musicid),
          musicid: target.musicid,
          musickey: target.musickey,
          unionid: target.unionid,
          refresh_key: target.refreshKey,
          loginMode: 2,
        };
    }
    const data = await this._client.execute(
      this._buildRequest(
        "music.login.LoginServer",
        "Login",
        param,
        {
          comm: { tmeLoginType: target.loginType },
          credential: target,
          allowErrorCodes: LOGIN_ERROR_CODES,
        },
      ),
    );
    try {
      const validated = this._validateResult(data);
      return Credential.fromDict(validated);
    } catch (e) {
      if (e instanceof LoginError) {
        throw new CredentialRefreshError(e.message, { code: e.code, data: e.data, cause: e });
      }
      throw e;
    }
  }

  /** 登出 */
  async logout(credential) {
    await this._client.execute(
      this._buildRequest(
        "music.login.LoginServer",
        "Logout",
        {},
        { credential, allowErrorCodes: LOGIN_ERROR_CODES, requireLogin: true },
      ),
    );
    if (!credential) {
      this._client.credential = new Credential();
    }
  }

  /**
   * 获取 QQ 登录二维码
   */
  async getQrcode(type = QrLoginType.QQ) {
    if (type === QrLoginType.QQ) return this._getQQQr();
    throw new Error(`暂不支持的二维码类型: ${type}`);
  }

  /**
   * 检查 QQ 二维码状态(简化版: 单次轮询, 不支持长连接监听)
   */
  async checkQrcode(qrcode) {
    if (qrcode.type !== QrLoginType.QQ) {
      throw new Error(`暂不支持的二维码类型: ${qrcode.type}`);
    }
    const qrsig = qrcode.identifier;
    let response;
    try {
      response = await this._client.request(
        "GET",
        "https://ssl.ptlogin2.qq.com/ptqrlogin",
        null,
        null,
        {
          params: {
            u1: "https://graph.qq.com/oauth2.0/login_jump",
            ptqrtoken: String(hash33(qrsig)),
            ptredirect: "0",
            h: "1",
            t: "1",
            g: "1",
            from_ui: "1",
            ptlang: "2052",
            action: `0-0-${Date.now()}`,
            js_ver: "20102616",
            js_type: "1",
            pt_uistyle: "40",
            aid: "716027609",
            daid: "383",
            pt_3rd_aid: "100497308",
            has_onekey: "1",
          },
          headers: { Referer: "https://xui.ptlogin2.qq.com/" },
          cookies: { qrsig },
          allowRedirects: false,
        },
      );
    } catch (e) {
      throw new ApiDataError("无效的 qrsig");
    }
    const match = QQ_STATUS_RE.exec(response.text);
    if (!match) throw new ApiDataError("获取二维码状态失败: 无法解析响应");
    const args = [];
    let m;
    QQ_ARGS_RE.lastIndex = 0;
    while ((m = QQ_ARGS_RE.exec(match[1]))) args.push(m[1]);
    if (args.length === 0) throw new ApiDataError("解析状态失败");
    const code = parseInt(args[0], 10);
    if (isNaN(code)) throw new ApiDataError("无效状态码");
    const event = mapEvent(code);
    if (event !== QrLoginEvent.DONE) return { event };
    if (args.length < 3) throw new ApiDataError("缺少登录参数");
    const sigx = QQ_SIGX_RE.exec(args[2]);
    const uin = QQ_UIN_RE.exec(args[2]);
    if (!sigx || !uin) throw new ApiDataError("解析 sigx/uin 失败");
    const cred = await this._authorizeQQQr(uin[1], sigx[1]);
    return { event, credential: cred };
  }

  /** 发送手机验证码 */
  async sendAuthcode(phone, countryCode = 86) {
    const param = {
      tmeAppid: "qqmusic",
      areaCode: String(countryCode),
    };
    if (typeof phone === "string") param.encryptedPhoneNo = phone;
    else param.phoneNo = String(phone);

    const resp = await this._client.execute(
      this._buildRequest(
        "music.login.LoginServer",
        "SendPhoneAuthCode",
        param,
        {
          comm: { tmeLoginMethod: 3 },
          platform: Platform.ANDROID,
          allowErrorCodes: "all",
        },
      ),
    );
    const data = resp.data ?? {};
    switch (resp.code) {
      case 100001:
        return { event: "CAPTCHA", info: data.securityURL };
      case 100002:
        return { event: "FREQUENCY" };
      case 0:
        return { event: "SEND" };
      default:
        throw new LoginError(`发送验证码失败: ${resp.code}`, { code: resp.code, data });
    }
  }

  /** 使用手机验证码登录 */
  async phoneAuthorize(phone, authCode) {
    const param = { code: authCode, loginMode: 1 };
    if (typeof phone === "string") param.encryptedPhoneNo = phone;
    else param.phoneNo = String(phone);
    const data = await this._client.execute(
      this._buildRequest(
        "music.login.LoginServer",
        "Login",
        param,
        {
          comm: { tmeLoginMethod: 3, tmeLoginType: 0 },
          platform: Platform.ANDROID,
          allowErrorCodes: LOGIN_ERROR_CODES,
        },
      ),
    );
    const validated = this._validateResult(data);
    return Credential.fromDict(validated);
  }

  // ==================== 内部 ====================

  async _getQQQr() {
    const resp = await this._client.request(
      "GET",
      "https://ssl.ptlogin2.qq.com/ptqrshow",
      null,
      null,
      {
        params: {
          appid: "716027609",
          e: "2",
          l: "M",
          s: "3",
          d: "72",
          v: "4",
          t: String(Math.random()),
          daid: "383",
          pt_3rd_aid: "100497308",
        },
        headers: { Referer: "https://xui.ptlogin2.qq.com/" },
        responseType: "arrayBuffer",
      },
    );
    const qrsig = resp.cookies.qrsig;
    if (!qrsig) throw new ApiDataError("获取 qrsig 失败");
    return {
      data: resp.content,
      type: QrLoginType.QQ,
      mime: "image/png",
      identifier: qrsig,
    };
  }

  async _authorizeQQQr(uin, sigx) {
    const checkResp = await this._client.request(
      "GET",
      "https://ssl.ptlogin2.graph.qq.com/check_sig",
      null,
      null,
      {
        params: {
          uin,
          pttype: "1",
          service: "ptqrlogin",
          nodirect: "0",
          ptsigx: sigx,
          s_url: "https://graph.qq.com/oauth2.0/login_jump",
          ptlang: "2052",
          ptredirect: "100",
          aid: "716027609",
          daid: "383",
          j_later: "0",
          low_login_hour: "0",
          regmaster: "0",
          pt_login_type: "3",
          pt_aid: "0",
          pt_aaid: "16",
          pt_light: "0",
          pt_3rd_aid: "100497308",
        },
        headers: { Referer: "https://xui.ptlogin2.qq.com/" },
        allowRedirects: false,
      },
    );

    // 兼容不同 QQ 端返回的 cookie 命名
    const cookies = checkResp.cookies;
    const pSkey =
      cookies.p_skey ??
      cookies["p-skey"] ??
      cookies.pskey ??
      cookies.ptsigx ??
      cookies.skey;

    if (process.env.QQMUSIC_DEBUG === "1") {
      console.log("[debug] check_sig cookies:", cookies);
      console.log("[debug] check_sig status:", checkResp.statusCode);
    }

    if (!pSkey) {
      const sc = checkResp.headers["set-cookie"];
      const body = checkResp.text.slice(0, 200).replace(/\s+/g, " ");
      const scPreview = (() => {
        if (!sc) return "<none>";
        if (Array.isArray(sc)) return sc.join(" || ");
        return String(sc);
      })();
      console.error(
        `[qqmusic-api] check_sig 失败: status=${checkResp.statusCode} ` +
          `set-cookie=${scPreview} body=${body}`,
      );
      throw new ApiDataError(
        `获取 p_skey 失败 (status=${checkResp.statusCode}, ` +
          `set-cookie=${scPreview || "<empty>"}, ` +
          `body=${body || "<empty>"})`,
      );
    }

    const authResp = await this._client.request(
      "POST",
      "https://graph.qq.com/oauth2.0/authorize",
      null,
      null,
      {
        body: new URLSearchParams({
          response_type: "code",
          client_id: "100497308",
          redirect_uri:
            "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
          scope: "get_user_info,get_app_friends",
          state: "state",
          switch: "",
          from_ptlogin: "1",
          src: "1",
          update_auth: "1",
          openapi: "1010_1030",
          g_tk: String(hash33(pSkey, 5381)),
          auth_time: String(Date.now()),
          ui: randomUUID(),
        }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://xui.ptlogin2.qq.com/",
        },
        cookies,
        allowRedirects: false,
      },
    );
    if (process.env.QQMUSIC_DEBUG === "1") {
      console.log(
        "[debug] authorize status:",
        authResp.statusCode,
        "location:",
        String(authResp.headers["location"] ?? "").slice(0, 200),
        "body:",
        authResp.text.slice(0, 200),
      );
    }
    const location = String(authResp.headers["location"] ?? "");
    const codeMatch = location.match(/(?<=code=)(.+?)(?=&)/);
    if (!codeMatch) {
      throw new ApiDataError(
        `获取 code 失败: status=${authResp.statusCode} location=${location.slice(0, 200) || "<empty>"}`,
      );
    }

    const data = await this._client.execute(
      this._buildRequest(
        "QQConnectLogin.LoginServer",
        "QQLogin",
        { code: codeMatch[1] },
        { comm: { tmeLoginType: 2 }, allowErrorCodes: LOGIN_ERROR_CODES },
      ),
    );
    if (process.env.QQMUSIC_DEBUG === "1") {
      console.log("[debug] QQLogin raw data:", JSON.stringify(data).slice(0, 800));
    }
    const validated = this._validateResult(data);
    if (process.env.QQMUSIC_DEBUG === "1") {
      console.log(
        "[debug] QQLogin validated:",
        JSON.stringify(validated).slice(0, 400),
      );
    }
    return Credential.fromDict(validated);
  }
}
