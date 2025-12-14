export class Signature
{
  /**
   * @param {{
   *  requestId: string;
   *  shortId: string;
   *  signerIdentity: string;
   *  provider: string;
   *  environment?: string | null;
   *  sts: string;
   *  stsUpdatedAt?: number | null;
   *  signerAuthorization?: any;
   *  signerAuthorizationExp?: number | null;
   *  signerCertificateAlias?: string | null;
   *  unsignedDocument: any;
   *  signedDocument?: any;
   *  requesterNotificationCallback?: string ? null;
   *  requesterCallbackSts: string;
   *  requesterCallbackStsUpdatedAt?: number | null;
   *  providerSignatureId?: string | null;
   *  signatureType?: string | null;
   *  signaturePolicy?: string | null;
   *  signatureHashAlgorithm?: string | null;
   *  signatureDocumentSource?: string | null;
   *  signatureAttributes: any;
   *  signatureSettingsProfileId?: string | null;
   *  tsaHashAlgorithm?: string | null;
   *  tsaHashAlgorithmOid?: string | null;
   *  tsaServerId?: string | null;
   *  serviceNotificationCallback?: string | null;
   *  checkCounter?: number;
   *  lastCheckAt?: number | null;
   *  lastCheckRequestId?: string | null;
   *  replacementFor?: string | null;
   *  replacedBy?: string | null;
   *  adminOnErrorLasNotifiedAt?: number | null;
   *  adminOnErrorNotificationCount?: number;
   *  requestOrigin?: RequestOrigin | null;
   * }} params
   */
  constructor(params)
  {
    this.requestId      = params.requestId;
    this.shortId        = params.shortId;
    this.signerIdentity = params.signerIdentity;

    this.provider     = params.provider;
    this.environment  = params.environment ?? null;

    this.sts          = params.sts;
    this.stsUpdatedAt = params.stsUpdatedAt ?? null;

    this.signerAuthorization    = params.signerAuthorization;
    this.signerAuthorizationExp = params.signerAuthorizationExp ?? null;
    this.signerCertificateAlias = params.signerCertificateAlias ?? null;

    this.unsignedDocument = params.unsignedDocument;
    this.signedDocument   = params.signedDocument ?? null;

    this.requesterNotificationCallback  = params.requesterNotificationCallback ?? null;
    this.requesterCallbackSts           = params.requesterCallbackSts;
    this.requesterCallbackStsUpdatedAt  = params.requesterCallbackStsUpdatedAt ?? null;

    this.providerSignatureId = params.providerSignatureId ?? null;

    this.signatureType              = params.signatureType ?? null;
    this.signaturePolicy            = params.signaturePolicy ?? null;
    this.signatureHashAlgorithm     = params.signatureHashAlgorithm ?? null;
    this.signatureDocumentSource    = params.signatureDocumentSource ?? null;
    this.signatureAttributes        = params.signatureAttributes;
    this.signatureSettingsProfileId = params.signatureSettingsProfileId ?? null;

    this.tsaHashAlgorithm = params.tsaHashAlgorithm ?? null;
    this.tsaServerId      = params.tsaServerId ?? null;

    this.serviceNotificationCallback = params.serviceNotificationCallback ?? null;

    this.checkCounter       = params.checkCounter ?? 0;
    this.lastCheckAt        = params.lastCheckAt ?? null;
    this.lastCheckRequestId = params.lastCheckRequestId ?? null;

    this.replacementFor = params.replacementFor ?? null;
    this.replacedBy     = params.replacedBy ?? null;

    this.adminOnErrorLasNotifiedAt      = params.adminOnErrorLasNotifiedAt ?? null;
    this.adminOnErrorNotificationCount  = params.adminOnErrorNotificationCount ?? 0;

    this.requestOrigin = params.requestOrigin ?? null;
  }

  /**
   * Cria uma assinatura nova.
   * 
   * @param {{
   *  requestId: string;
   *  shortId: string;
   *  signerIdentity: string;
   *  provider: string;
   *  environment?: string | null;
   *  sts: string;
   *  unsignedDocument: any;
   *  signatureAttributes: any;
   *  callbackUrl?: string | null;
   *  serviceNotificationCallback?: string | null;
   *  revoke?: string | null;
   *  requestOrigin?: RequestOrigin | null;
   *  now?: number; // timestamp em ms
   * }} input
   */
  static createNew(input)
  {
    const now = input.now ?? Date.now();

    return new Signature({
      requestId: input.requestId,
      shortId: input.shortId,
      signerIdentity: input.signerIdentity,

      provider: input.provider,
      environment: input.environment ?? null,

      sts: input.sts,
      stsUpdatedAt: input.sts ? now : null,

      signerAuthorization: input.signerAuthorization ?? null,
      signerAuthorizationExp: input.signerAuthorizationExp ?? null,
      signerCertificateAlias: input.signerCertificateAlias ?? null,

      unsignedDocument: input.unsignedDocument,
      signedDocument: null,

      requesterNotificationCallback: input.callbackUrl ?? null,
      requesterCallbackSts: 'AWAITING_SIGNATURE',
      requesterCallbackStsUpdatedAt: now,

      providerSignatureId: null,

      signatureType: null,
      signaturePolicy: null,
      signatureHashAlgorithm: null,
      signatureDocumentSource: null,
      signatureAttributes: input.signatureAttributes,
      signatureSettingsProfileId: null,

      tsaHashAlgorithm: null,
      tsaServerId: null,

      serviceNotificationCallback: input.serviceNotificationCallback ?? null,

      checkCounter: 0,
      lastCheckAt: null,
      lastCheckRequestId: null,

      replacementFor: input.revoke ?? null,
      replacedBy: null,

      adminOnErrorLasNotifiedAt: null,
      adminOnErrorNotificationCount: 0,

      requestOrigin: input.requestOrigin ?? null,
    });
  }
}