export class RequestOrigin
{
  /**
   * @param {{
   *  client?: string | null;
   *  apiKey?: string | null;
   *  apiKeyId?: string | null;
   *  sourceIp?: string | null;
   *  userAgent?: string | null;
   * }} params
   */
  constructor({ client, apiKey, apiKeyId, sourceIp, userAgent })
  {
    this.client     = client || null;
    this.apiKey     = apiKey || null;
    this.apiKeyId   = apiKeyId || null;
    this.sourceIp   = sourceIp || null;
    this.userAgent  = userAgent || null;
  }

  static fromRaw(raw = {})
  {
    return new RequestOrigin({
      client:    raw.client,
      apiKey:    raw.apiKey,
      apiKeyId:  raw.apiKeyId,
      sourceIp:  raw.sourceIp,
      userAgent: raw.userAgent,
    });
  }

  toJson()
  {
    return {
      client:    this.client,
      apiKey:    this.apiKey,
      apiKeyId:  this.apiKeyId,
      sourceIp:  this.sourceIp,
      userAgent: this.userAgent,
    };
  }
}