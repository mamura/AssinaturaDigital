export class SignatureStatusService {
  buildStatusResponse(signatureRecord) {
    const status = signatureRecord.sts === "SIGNED" ? "VALID" : "INVALID";

    return {
      status,
      documentRealm: "private",
      signingTimeStamp: null,
      kind: null,
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
    };
  }
}
