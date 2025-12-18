export class SignatureRequest
{
  constructor({
    requestId,
    shortId,
    requester,
    signers,
    unsignedDocumentLocation,
    status,
    provider,
    createdAt,
  }) {
    this.requestId                = requestId;
    this.shortId                  = shortId;
    this.requester                = requester;
    this.signers                  = signers;
    this.unsignedDocumentLocation = unsignedDocumentLocation;
    this.status                   = status;
    this.provider                 = provider;
    this.createdAt                = createdAt;
  }


  static create({
    requestId,
    shortId,
    requester,
    signers,
    unsignedDocumentLocation,
    provider,
  }) {
    const now = new Date().toISOString();

    return new SignatureRequest({
      requestId,
      shortId,
      requester,
      signers,
      unsignedDocumentLocation,
      status: 'PENDING',
      provider,
      createdAt: now,
    });
  }
}