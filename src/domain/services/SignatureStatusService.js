export class SignatureStatusService {
  /**
   * 
   * @param {object} signatureRecord // registro principal (sts, requestId, signerIdentity, shortId, etc.)
   * @param {object|null} signatureDetails //detalhes adicionais (unsignedDocument, signedDocument, replacedBy, ...)
   */
  buildStatusResponse(signatureRecord, signatureDetails = null) {
    let status      = signatureRecord.sts === "SIGNED" ? "VALID" : "INVALID";
    let kind        = null;
    let replacedBy  = null;

    if (signatureDetails) {
      kind = signatureDetails?.unsignedDocument?.kind ?? null;

      if (signatureDetails.replacedBy) {
        status      = "REPLACED";
        replacedBy  = signatureDetails.replacedByShortId ?? null;
      }
    }

    return {
      status,
      documentRealm: "private",
      signingTimeStamp: null,
      kind,
      signerName: null,
      certificates: [],
      rawContent: null,
      subjectName: null,
      subjectAuthorize: {
        paramKind: null,
        paramValue: null,
      },
      sourceDocumentFiles: {
        status: "PRIVATE",
        files: [],
      },
      verifyingTimeStamp: Date.now(),
      authenticityCode: null,
      verifierKey: null,
      longId: signatureRecord.requestId ?? null,
      replacedBy,
    };
  }
}
