/**
 * 平台与版本策略.
 * 实现 Android / Desktop / Web 三个平台以及默认的版本档案.
 */

import { hash33 } from "./utils/common.js";

export const Platform = {
  ANDROID: "android",
  DESKTOP: "desktop",
  WEB: "web",
};

const DEFAULT_ANDROID = {
  ct: 11,
  cv: 14090008,
  v: 14090008,
  uaVersion: 14090008,
  qimeiAppVersion: "14.9.0.8",
  qimeiSdkVersion: "1.2.13.6",
};

const DEFAULT_DESKTOP = {
  ct: 19,
  cv: 2201,
};

const DEFAULT_WEB = {
  ct: 24,
  cv: 4747474,
  platform: "yqq.json",
};

export class VersionPolicy {
  constructor(android, desktop, web) {
    this._android = android;
    this._desktop = desktop;
    this._web = web;
    this._commCache = new Map();
  }

  getProfile(platform) {
    switch (platform) {
      case Platform.ANDROID:
        return this._android;
      case Platform.DESKTOP:
        return this._desktop;
      case Platform.WEB:
        return this._web;
    }
  }

  /**
   * 构建 comm 参数.
   */
  buildComm(platform, credential, device, qimei, guid) {
    const cacheKey = JSON.stringify({
      p: platform,
      c: credential,
      d:
        platform === Platform.ANDROID
          ? {
              a: device.androidId,
              r: device.version.release,
              m: device.model,
              s: device.version.sdk,
              f: device.fingerprint,
              u: device.sessionUid,
              sid: device.sessionSid,
            }
          : null,
      q: qimei ? Object.fromEntries(Object.entries(qimei).sort()) : null,
      g: guid,
    });
    const cached = this._commCache.get(cacheKey);
    if (cached) return { ...cached };

    const profile = this.getProfile(platform);
    const comm = {};

    if (platform === Platform.ANDROID) {
      Object.assign(comm, {
        ct: profile.ct,
        cv: profile.cv,
        v: profile.v,
        chid: "10003505",
        qq: credential.musicid ? String(credential.musicid) : undefined,
        authst: credential.musickey || undefined,
        tmeAppID: "qqmusic",
        tmeLoginType: credential.loginType || undefined,
        QIMEI: qimei?.q16 ?? "",
        QIMEI36: qimei?.q36 ?? "",
        OpenUDID: guid,
        udid: guid,
        uid: device.sessionUid,
        OpenUDID2: guid,
        sid: device.sessionSid,
        aid: device.androidId,
        os_ver: device.version.release,
        phonetype: device.model,
        devicelevel: String(device.version.sdk),
        newdevicelevel: String(device.version.sdk),
        rom: device.fingerprint,
      });
    } else if (platform === Platform.DESKTOP) {
      Object.assign(comm, {
        ct: profile.ct,
        cv: profile.cv,
        platform: profile.platform,
        chid: "0",
        uin: credential.musickey ? credential.musicid : undefined,
        g_tk: this.getGtk(credential),
        guid: guid.toUpperCase(),
      });
    } else {
      const gTk = this.getGtk(credential);
      Object.assign(comm, {
        ct: profile.ct,
        cv: profile.cv,
        platform: profile.platform,
        chid: "0",
        uin: credential.musickey ? credential.musicid : undefined,
        g_tk: gTk,
        g_tk_new_20200303: gTk,
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: 0,
        need_new_code: 1,
      });
    }

    // 清理 undefined
    for (const k of Object.keys(comm)) {
      if (comm[k] === undefined) delete comm[k];
    }
    this._commCache.set(cacheKey, comm);
    return { ...comm };
  }

  /**
   * 生成对应平台的 User-Agent.
   */
  getUserAgent(platform, device) {
    if (platform === Platform.ANDROID) {
      const profile = this.getProfile(platform);
      const uaVersion = profile.uaVersion ?? profile.cv;
      return `QQMusic ${uaVersion}(android ${device.version.release})`;
    }
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
  }

  getQimeiAppVersion() {
    return this.getProfile(Platform.ANDROID).qimeiAppVersion ?? "14.9.0.8";
  }

  getQimeiSdkVersion() {
    return this.getProfile(Platform.ANDROID).qimeiSdkVersion ?? "1.2.13.6";
  }

  static getGtk(credential) {
    if (credential.musickey) return hash33(credential.musickey, 5381);
    return 5381;
  }

  getGtk(credential) {
    return VersionPolicy.getGtk(credential);
  }
}

export const DEFAULT_VERSION_POLICY = new VersionPolicy(
  DEFAULT_ANDROID,
  DEFAULT_DESKTOP,
  DEFAULT_WEB,
);
