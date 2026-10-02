/**
 * 登录凭证.
 */

const ALIAS_MAP = {
  // 字段名(后端真实返回)  ->  Credential 类的字段名
  openid: "openid",
  refresh_token: "refreshToken",
  refreshToken: "refreshToken",
  access_token: "accessToken",
  accessToken: "accessToken",
  expired_at: "expiredAt",
  expiredAt: "expiredAt",
  musicid: "musicid",
  musickey: "musickey",
  unionid: "unionid",
  str_musicid: "strMusicid",
  strMusicid: "strMusicid",
  refresh_key: "refreshKey",
  refreshKey: "refreshKey",
  musickeycreatetime: "musickeyCreateTime",
  musickeyCreateTime: "musickeyCreateTime",
  key_expires_in: "keyExpiresIn",
  keyExpiresIn: "keyExpiresIn",
  first_login: "firstLogin",
  firstLogin: "firstLogin",
  bind_account_type: "bindAccountType",
  bindAccountType: "bindAccountType",
  need_refresh_key_in: "needRefreshKeyIn",
  needRefreshKeyIn: "needRefreshKeyIn",
  encrypt_uin: "encryptUin",
  encryptUin: "encryptUin",
  login_type: "loginType",
  loginType: "loginType",
};

export class Credential {
  constructor(init = {}) {
    this.openid = "";
    this.refreshToken = "";
    this.accessToken = "";
    this.expiredAt = 0;
    this.musicid = 0;
    this.musickey = "";
    this.unionid = "";
    this.strMusicid = "";
    this.refreshKey = "";
    this.musickeyCreateTime = 0;
    this.keyExpiresIn = 0;
    this.firstLogin = 0;
    this.bindAccountType = 0;
    this.needRefreshKeyIn = 0;
    this.encryptUin = "";
    this.loginType = 0;

    Object.assign(this, init);
    // 若未提供 loginType 则根据 musickey 前缀推断
    if (init.loginType === undefined && init.musickey) {
      this.loginType = typeof init.musickey === "string" && init.musickey.startsWith("W_X") ? 1 : 2;
    }
  }

  /** 检查是否已登录 (有 musicid 和 musickey) */
  isLoggedIn() {
    return Boolean(this.musicid && this.musickey);
  }

  /** 检查登录是否已过期 */
  isExpired() {
    if (!this.musickeyCreateTime || !this.keyExpiresIn) return false;
    const now = Math.floor(Date.now() / 1000);
    return now >= this.musickeyCreateTime + this.keyExpiresIn;
  }

  /** 序列化为可发送的字典 */
  toJSON() {
    return {
      openid: this.openid,
      refreshToken: this.refreshToken,
      accessToken: this.accessToken,
      expiredAt: this.expiredAt,
      musicid: this.musicid,
      musickey: this.musickey,
      unionid: this.unionid,
      strMusicid: this.strMusicid,
      refreshKey: this.refreshKey,
      musickeyCreateTime: this.musickeyCreateTime,
      keyExpiresIn: this.keyExpiresIn,
      firstLogin: this.firstLogin,
      bindAccountType: this.bindAccountType,
      needRefreshKeyIn: this.needRefreshKeyIn,
      encryptUin: this.encryptUin,
      loginType: this.loginType,
    };
  }

  /** 从任意字段名(后端返回的 dict)中解析 */
  static fromDict(data) {
    const mapped = {};
    for (const [k, v] of Object.entries(data)) {
      const target = ALIAS_MAP[k] ?? k;
      if (target) mapped[target] = v;
    }
    return new Credential(mapped);
  }
}
