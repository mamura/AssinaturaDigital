import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignerAuthorization } from "../../../domain/entities/SignerAuthorization.js";
import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin.js";

describe("SignerAuthorization", () => {
  it("deve preencher todos os campos no construtor e aplicar defaults", () => {
    const origin = new RequestOrigin({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "api-key-id",
      sourceIp: "127.0.0.1",
      userAgent: "Vitest/1.0",
    });

    const auth = new SignerAuthorization({
      requestId: "req-auth-123",
      signerIdentity: "signer-abc",

      provider: "TEST_PROVIDER",
      sts: "PENDING",
      stsUpdatedAt: 1111111111111,

      jti: "jwt-id-001",
      expiresInSeconds: 3600,
      signerCertificates: [{ alias: "cert1" }],
      stampExpiration: 2222222222222,

      cached: true,
      environment: "local",
      err: null,
      useCache: true,

      requestOrigin: origin,
    });

    expect(auth.requestId).toBe("req-auth-123");
    expect(auth.signerIdentity).toBe("signer-abc");
    expect(auth.provider).toBe("TEST_PROVIDER");
    expect(auth.sts).toBe("PENDING");
    expect(auth.stsUpdatedAt).toBe(1111111111111);

    expect(auth.jti).toBe("jwt-id-001");
    expect(auth.expiresInSeconds).toBe(3600);
    expect(auth.signerCertificates).toEqual([{ alias: "cert1" }]);
    expect(auth.stampExpiration).toBe(2222222222222);

    expect(auth.cached).toBe(true);
    expect(auth.environment).toBe("local");
    expect(auth.err).toBeNull();
    expect(auth.useCache).toBe(true);

    expect(auth.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(auth.requestOrigin.client).toBe("TEST_CLIENT");
  });

  it("deve aplicar valores padrão quando campos opcionais não forem informados", () => {
    const auth = new SignerAuthorization({
      requestId: "req-auth-123",
      signerIdentity: "signer-abc",
      provider: "TEST_PROVIDER",
      sts: "PENDING",
      // sem stsUpdatedAt, jti, etc.
    });

    expect(auth.stsUpdatedAt).toBeNull();
    expect(auth.jti).toBeNull();
    expect(auth.expiresInSeconds).toBeNull();
    expect(auth.signerCertificates).toBeNull();
    expect(auth.stampExpiration).toBeNull();

    expect(auth.cached).toBeNull();
    expect(auth.environment).toBeNull();
    expect(auth.err).toBeNull();
    expect(auth.useCache).toBe(false);
    expect(auth.requestOrigin).toBeNull();
  });

  describe("createNew", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("deve criar uma nova autorização com stsUpdatedAt definido quando sts é truthy", () => {
      const origin = new RequestOrigin({
        client: "TEST_CLIENT",
        apiKey: "api-key",
        apiKeyId: "api-key-id",
        sourceIp: "127.0.0.1",
        userAgent: "Vitest/1.0",
      });

      const auth = SignerAuthorization.createNew({
        requestId: "req-auth-999",
        signerIdentity: "signer-xyz",
        provider: "TEST_PROVIDER",
        sts: "AUTHORIZED",
        jti: "jwt-id-999",
        expiresInSeconds: 600,
        signerCertificates: [{ alias: "cert-main" }],
        stampExpiration: 3333333333333,
        environment: "prod",
        useCache: true,
        requestOrigin: origin,
      });

      expect(auth.requestId).toBe("req-auth-999");
      expect(auth.signerIdentity).toBe("signer-xyz");
      expect(auth.provider).toBe("TEST_PROVIDER");
      expect(auth.sts).toBe("AUTHORIZED");

      // Como usamos fake timers, Date.now() == 2025-01-01T12:00:00.000Z
      expect(auth.stsUpdatedAt).toBe(new Date("2025-01-01T12:00:00.000Z").getTime());

      expect(auth.jti).toBe("jwt-id-999");
      expect(auth.expiresInSeconds).toBe(600);
      expect(auth.signerCertificates).toEqual([{ alias: "cert-main" }]);
      expect(auth.stampExpiration).toBe(3333333333333);

      expect(auth.cached).toBeNull();             // createNew força cached = null
      expect(auth.environment).toBe("prod");
      expect(auth.err).toBeNull();                // createNew força err = null
      expect(auth.useCache).toBe(true);

      expect(auth.requestOrigin).toBeInstanceOf(RequestOrigin);
      expect(auth.requestOrigin.client).toBe("TEST_CLIENT");
    });

    it("deve definir stsUpdatedAt como null quando sts for falsy", () => {
      const auth = SignerAuthorization.createNew({
        requestId: "req-auth-000",
        signerIdentity: "signer-000",
        provider: "TEST_PROVIDER",
        sts: "", // falsy
      });

      expect(auth.sts).toBe("");
      expect(auth.stsUpdatedAt).toBeNull();
    });
  });
});
