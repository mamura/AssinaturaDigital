import { RequestOrigin } from "../valueObjects/RequestOrigin.js";

export class SignatureCheck
{
  /**
   * @param {{
   *  requestId: string;
   *  signatureRequestId?: string | null;
   *  signatureShortId?: string | null;
   *  checkParameter: any;
   *  checkResult: any;
   *  requestOrigin?: RequestOrigin | null;
   * }} params
   */
  constructor(params) {
    this.requestId          = params.requestId;
    this.signatureRequestId = params.signatureRequestId ?? null;
    this.signatureShortId   = params.signatureShortId ?? null;
    this.checkParameter     = params.checkParameter;
    this.checkResult        = params.checkResult;
    this.requestOrigin      = params.requestOrigin ?? null;
  }
}