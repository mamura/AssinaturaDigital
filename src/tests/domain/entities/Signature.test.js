import { describe, expect, it } from "vitest";
import { Signature } from "../../../domain/entities/Signature.js";
import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin";

function makeMinimalSignature(overrides = {}) {
  const now = Date.now();

  return new Signature({
    requestId: "req-123",
    shortId: "short-abc",
    signerIdentity: "signer-001",

    provider: "TEST_PROVIDER",
    environment: "local",

    sts: "PENDING",
    stsUpdatedAt: now,

    signerAuthorization: null,
    signerAuthorizationExp: null,
    signerCertificateAlias: null,

    unsignedDocument: {
      fileName: "file.pdf",
      size: 1234,
      contentType: "application/pdf",
    },
    signedDocument: null,

    requesterNotificationCallback: null,
    requesterCallbackSts: "AWAITING_SIGNATURE",
    requesterCallbackStsUpdatedAt: now,

    providerSignatureId: null,

    signatureType: null,
    signaturePolicy: null,
    signatureHashAlgorithm: null,
    signatureDocumentSource: null,
    signatureAttributes: {},
    signatureSettingsProfileId: null,

    tsaHashAlgorithm: null,
    tsaServerId: null,

    serviceNotificationCallback: null,

    checkCounter: 0,
    lastCheckAt: null,
    lastCheckRequestId: null,

    replacementFor: null,
    replacedBy: null,

    adminOnErrorLasNotifiedAt: null,
    adminOnErrorNotificationCount: 0,

    requestOrigin: null,

    ...overrides,
  });
}

describe("Signature entity", () => {
  it("deve criar uma assinatura com os campos básicos", () => {
    const now = Date.now();

    const signature = new Signature({
      requestId: "req-123",
        shortId: "short-abc",
        signerIdentity: "signer-001",

        provider: "TEST_PROVIDER",
        environment: "local",

        sts: "PENDING",
        stsUpdatedAt: now,

        signerAuthorization: null,
        signerAuthorizationExp: null,
        signerCertificateAlias: null,

        unsignedDocument: {
          fileName: "file.pdf",
          size: 1234,
          contentType: "application/pdf",
        },
        signedDocument: null,

        requesterNotificationCallback: null,
        requesterCallbackSts: "AWAITING_SIGNATURE",
        requesterCallbackStsUpdatedAt: now,

        providerSignatureId: null,

        signatureType: null,
        signaturePolicy: null,
        signatureHashAlgorithm: null,
        signatureDocumentSource: null,
        signatureAttributes: {},
        signatureSettingsProfileId: null,

        tsaHashAlgorithm: null,
        tsaServerId: null,

        serviceNotificationCallback: null,

        checkCounter: 0,
        lastCheckAt: null,
        lastCheckRequestId: null,

        replacementFor: null,
        replacedBy: null,

        adminOnErrorLasNotifiedAt: null,
        adminOnErrorNotificationCount: 0,

        requestOrigin: null,
    });

    expect(signature.requestId).toBe("req-123");
    expect(signature.shortId).toBe("short-abc");
    expect(signature.signerIdentity).toBe("signer-001");

    expect(signature.provider).toBe("TEST_PROVIDER");
    expect(signature.environment).toBe("local");
    expect(signature.sts).toBe("PENDING");
    expect(signature.stsUpdatedAt).toBe(now);

    expect(signature.unsignedDocument).toEqual({
      fileName: "file.pdf",
      size: 1234,
      contentType: "application/pdf",
    });

    expect(signature.signedDocument).toBeNull();

    expect(signature.requesterCallbackSts).toBe("AWAITING_SIGNATURE");
    expect(signature.requesterCallbackStsUpdatedAt).toBe(now);

    expect(signature.checkCounter).toBe(0);
    expect(signature.lastCheckAt).toBeNull();
    expect(signature.lastCheckRequestId).toBeNull();

    expect(signature.requestOrigin).toBeNull();
  });
  
  it("deve aceitar um RequestOrigin válido", () => {
    const origin = new RequestOrigin({
      client: "API_CLIENT",
      apiKey: "api-key",
      apiKeyId: "key-id-1",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    });

    const signature = makeMinimalSignature({ requestOrigin: origin });

    expect(signature.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(signature.requestOrigin.client).toBe("API_CLIENT");
  });

  it("deve permitir atualização explícita de campos mutáveis via atribuição direta", () => {
    const signature = makeMinimalSignature();

    signature.sts = "DONE";
    signature.signedDocument = {
      fileName: "file-signed.pdf",
      size: 2048,
      contentType: "application/pdf",
    };
    signature.providerSignatureId = "prov-789";

    expect(signature.sts).toBe("DONE");
    expect(signature.signedDocument).toEqual({
      fileName: "file-signed.pdf",
      size: 2048,
      contentType: "application/pdf",
    });
    expect(signature.providerSignatureId).toBe("prov-789");
  });

  it("deve permitir campos opcionais ausentes no construtor (usando defaults do próprio construtor)", () => {
    const signature = new Signature({
      requestId: "req-999",
      shortId: "short-999",
      signerIdentity: "signer-999",

      provider: "TEST_PROVIDER",
      environment: "local",

      sts: "PENDING",
      stsUpdatedAt: Date.now(),

      unsignedDocument: {
        fileName: "file.pdf",
        size: 1234,
        contentType: "application/pdf",
      },
    });

    expect(signature.requestId).toBe("req-999");
    expect(signature.shortId).toBe("short-999");
    expect(signature.signerIdentity).toBe("signer-999");

    expect(signature.signedDocument ?? null).toBeNull();
    expect(signature.requestOrigin ?? null).toBeNull();
  });
  
});