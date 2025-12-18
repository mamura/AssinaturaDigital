import { describe, it, expect } from "vitest";
import { SignatureCheck } from "../../../domain/entities/SignatureCheck.js";
import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin.js";

describe("SignatureCheck", () => {
  it("deve armazenar os campos básicos no construtor", () => {
    const origin = new RequestOrigin({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "key-id",
      sourceIp: "127.0.0.1",
      userAgent: "Vitest/1.0",
    });

    const check = new SignatureCheck({
      requestId: "req-check-123",
      signatureRequestId: "req-sign-999",
      signatureShortId: "short-abc",
      checkParameter: { subjectAuthorizeParam: true },
      checkResult: { status: "PENDING", providerStatus: "WAITING" },
      requestOrigin: origin,
    });

    expect(check.requestId).toBe("req-check-123");
    expect(check.signatureRequestId).toBe("req-sign-999");
    expect(check.signatureShortId).toBe("short-abc");
    expect(check.checkParameter).toEqual({ subjectAuthorizeParam: true });
    expect(check.checkResult).toEqual({
      status: "PENDING",
      providerStatus: "WAITING",
    });
    expect(check.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(check.requestOrigin.client).toBe("TEST_CLIENT");
  });

  it("deve permitir requestOrigin nulo", () => {
    const check = new SignatureCheck({
      requestId: "req-check-123",
      signatureRequestId: "req-sign-999",
      signatureShortId: "short-abc",
      checkParameter: {},
      checkResult: {},
      requestOrigin: null,
    });

    expect(check.requestOrigin).toBeNull();
  });
});
