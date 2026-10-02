/**
 * 请求描述符.
 *
 * 这是整个库的核心抽象,业务模块通过 _build_request 返回一个
 * Request 对象,该对象实现了 thenable 接口,既可被 await,
 * 也可以传入 Client.gather() 进行批量合并.
 */

export class Request {
  constructor(init) {
    this._client = init._client;
    this.module = init.module;
    this.method = init.method;
    this.param = init.param;
    this.responseModel = init.responseModel;
    this.comm = init.comm;
    this.overrideComm = init.overrideComm ?? false;
    this.isJce = init.isJce ?? false;
    this.preserveBool = init.preserveBool ?? false;
    this.credential = init.credential;
    this.platform = init.platform;
    this.allowErrorCodes = init.allowErrorCodes;
    this.parseOnAllow = init.parseOnAllow ?? false;
    this.sign = init.sign ?? false;
    this.pagerMeta = init.pagerMeta;
    this.refreshMeta = init.refreshMeta;
  }

  /** 实现 thenable, 使 `await request` 生效 */
  then(onfulfilled, onrejected) {
    return this._client.execute(this).then(onfulfilled, onrejected);
  }

  /** 返回一个替换了部分字段的新 Request (不修改原对象) */
  replace(changes = {}) {
    return new Request({
      ...this.toInit(),
      param: changes.param ?? deepClone(this.param),
      comm: changes.comm ?? (this.comm ? deepClone(this.comm) : undefined),
      overrideComm: changes.overrideComm ?? this.overrideComm,
      ...changes,
    });
  }

  toInit() {
    return {
      _client: this._client,
      module: this.module,
      method: this.method,
      param: this.param,
      responseModel: this.responseModel,
      comm: this.comm,
      overrideComm: this.overrideComm,
      isJce: this.isJce,
      preserveBool: this.preserveBool,
      credential: this.credential,
      platform: this.platform,
      allowErrorCodes: this.allowErrorCodes,
      parseOnAllow: this.parseOnAllow,
      sign: this.sign,
      pagerMeta: this.pagerMeta,
      refreshMeta: this.refreshMeta,
    };
  }
}

function deepClone(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}
