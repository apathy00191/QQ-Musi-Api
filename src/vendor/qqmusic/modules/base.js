/**
 * API 模块基类.
 *
 * 提供所有业务模块共用的 _build_request 工厂方法.
 */

import { Request } from "../models/request.js";
import { CredentialInvalidError } from "../exceptions.js";
import { Platform, VersionPolicy } from "../versioning.js";

export class ApiModule {
  constructor(_client) {
    this._client = _client;
  }

  _requireLogin(credential) {
    const target = credential ?? this._client.credential;
    if (!target.musicid || !target.musickey) {
      throw new CredentialInvalidError("接口需要有效登录凭证");
    }
    return target;
  }

  async _request(method, url, credential = null, platform = null, options = {}) {
    return this._client.request(method, url, credential, platform, options);
  }

  _buildQueryCommonParams(platform = null) {
    const profile = this._client._versionPolicy;
    const p = profile.getProfile(platform ?? this._client.platform);
    return { ct: p.ct, cv: p.cv };
  }

  /**
   * 构造请求描述符.
   */
  _buildRequest(module, method, param, options = {}) {
    if (options.pagerMeta && options.refreshMeta) {
      throw new Error("pagerMeta 与 refreshMeta 不能同时声明");
    }
    let credential = options.credential ?? undefined;
    if (options.requireLogin) {
      credential = this._requireLogin(credential ?? null);
    }
    return new Request({
      _client: this._client,
      module,
      method,
      param,
      comm: options.comm,
      overrideComm: options.overrideComm ?? false,
      isJce: options.isJce ?? false,
      preserveBool: options.preserveBool ?? false,
      credential,
      platform: options.platform,
      allowErrorCodes: options.allowErrorCodes,
      parseOnAllow: options.parseOnAllow ?? false,
      sign: options.sign ?? false,
      pagerMeta: options.pagerMeta,
      refreshMeta: options.refreshMeta,
    });
  }
}
