/**
 * 自定义异常类.
 */

export class BaseApiException extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.data = options.data;
    if (options.cause !== undefined) {
      // ES2022 supports `cause` natively; we mirror it on Node 18+.
      this.cause = options.cause;
    }
  }
}

export class HTTPError extends BaseApiException {
  constructor(message, options = {}) {
    super(message, options);
    this.statusCode = options.statusCode;
  }
}

export class NetworkError extends BaseApiException {}

export class ApiDataError extends BaseApiException {}

export class ApiException extends BaseApiException {}

export class GlobalApiError extends ApiException {}

export class CgiApiException extends ApiException {}

/** 凭证相关错误 */
export class CredentialInvalidError extends BaseApiException {}
export class CredentialExpiredError extends BaseApiException {}
export class CredentialRefreshError extends BaseApiException {}

/** 登录业务错误 */
export class LoginError extends BaseApiException {}
export class LoginAuthExpiredError extends LoginError {}
export class LoginAccountRestrictedError extends LoginError {}
export class LoginDeviceLimitError extends LoginError {}
export class LoginRateLimitError extends LoginError {}

/** 限流 / 签名相关 */
export class RatelimitedError extends BaseApiException {}
export class SignatureRequiredError extends BaseApiException {}
