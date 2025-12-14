import { RequestOrigin } from "../valueObjects/RequestOrigin";

export class SignerAuthorization
{
  /**
   * @param {{
   *  requestId: string;
   *  signerIdentity: string;
   *  provider: string;
   *  sts: string;
   *  stsUpdatedAt?: number | null;
   *  jti?: string | null;
   *  expiresInSeconds?: number | null;
   *  signerCertificates?: any;
   *  stampExpiration?: number | null;
   *  cached?: any;
   *  environment?: string | null;
   *  err?: any;
   *  useCache?: boolean;
   *  requestOrigin?: RequestOrigin | null;
   * }} params
   */
  constructor(params)
  {
    this.requestId      = params.requestId;
    this.signerIdentity = params.signerIdentity;

    this.provider     = params.provider;
    this.sts          = params.sts;
    this.stsUpdatedAt = params.stsUpdatedAt ?? null;

    this.jti                = params.jti ?? null;
    this.expiresInSeconds   = params.expiresInSeconds ?? null;
    this.signerCertificates = params.signerCertificates ?? null;
    this.stampExpiration    = params.stampExpiration ?? null;

    this.cached       = params.cached ?? null;
    this.environment  = params.environment ?? null;
    this.err          = params.err ?? null;
    this.useCache     = params.useCache ?? false;

    this.requestOrigin = params.requestOrigin ?? null;
  }

  /**
   * Cria uma nova autorização de signatário
   */
  static createNew(input)
  {
    const now = Date.now();

    return new SignerAuthorization({
      requestId:      input.requestId,
      signerIdentity: input.signerIdentity,
      provider: input.provider,
      sts: input.sts,
      stsUpdatedAt: input.sts ? now : null,
      jti: input.jti ?? null,
      expiresInSeconds: input.expiresInSeconds ?? null,
      signerCertificates: input.signerCertificates ?? null,
      stampExpiration: input.stampExpiration ?? null,
      cached: null,
      environment: input.environment ?? null,
      err: null,
      useCache: input.useCache ?? false,
      requestOrigin: input.requestOrigin ?? null,
    });
  }
}