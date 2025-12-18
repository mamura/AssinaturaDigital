import { describe, it, expect, vi, beforeEach } from "vitest";

import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin.js";
import { DynamoSignerAuthorizationRepository } from "../../../infrastructure/repositories/DynamoSignersAuthorizationRepository.js";
// Se a classe existir, esse import deve bater. Se não existir ainda, depois ajustamos.
// import { SignerAuthorization } from "../../../domain/entities/signatures/SignerAuthorization.js";

function makeAuth(overrides = {}) {
  return {
    requestId: "req-auth-123",
    signerIdentity: "signer-abc",

    provider: "TEST_PROVIDER",
    sts: "PENDING",
    stsUpdatedAt: 1111111111111,

    jti: "jwt-id-001",
    expiresInSeconds: 3600,
    signerCertificates: [
      { alias: "cert1", serialNumber: "ABC123" },
    ],
    stampExpiration: 2222222222222,

    cached: false,
    environment: "local",
    err: null,
    useCache: true,

    requestOrigin: new RequestOrigin({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "api-key-id",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    }),

    ...overrides,
  };
}

describe("DynamoSignerAuthorizationRepository", () => {
  let sendMock;
  let repo;

  beforeEach(() => {
    sendMock = vi.fn().mockResolvedValue({});
    const fakeDocClient = { send: sendMock };

    repo = new DynamoSignerAuthorizationRepository(
      fakeDocClient,
      "SignersAuthorizationTableTest",
    );
  });

  it("deve criar um registro de autorização com create()", async () => {
    const auth = makeAuth();

    await repo.create(auth);

    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    const input = call.input;

    expect(input.TableName).toBe("SignersAuthorizationTableTest");

    const item = input.Item;
    expect(item.requestId).toBe("req-auth-123");
    expect(item.signerIdentity).toBe("signer-abc");
    expect(item.provider).toBe("TEST_PROVIDER");
    expect(item.sts).toBe("PENDING");

    // requestOrigin deve estar serializado em JSON simples
    expect(item.requestOrigin).toEqual({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "api-key-id",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    });
  });

  it("deve retornar null em findByRequestIdAndSigner quando Item não existir", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.findByRequestIdAndSigner(
      "req-nao-existe",
      "signer-x",
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];

    expect(call.input.TableName).toBe("SignersAuthorizationTableTest");
    expect(call.input.Key).toEqual({
      requestId: "req-nao-existe",
      signerIdentity: "signer-x",
    });

    expect(result).toBeNull();
  });

  it("deve retornar um objeto de autorização em findByRequestIdAndSigner quando Item existir", async () => {
    const auth = makeAuth();
    const item = repo._toItem(auth);

    sendMock.mockResolvedValueOnce({ Item: item });

    const result = await repo.findByRequestIdAndSigner(
      "req-auth-123",
      "signer-abc",
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];

    expect(call.input.TableName).toBe("SignersAuthorizationTableTest");
    expect(call.input.Key).toEqual({
      requestId: "req-auth-123",
      signerIdentity: "signer-abc",
    });

    // aqui não uso instanceOf pra não depender do import da entidade,
    // apenas verifico os campos.
    expect(result).toBeTruthy();
    expect(result.requestId).toBe("req-auth-123");
    expect(result.signerIdentity).toBe("signer-abc");
    expect(result.provider).toBe("TEST_PROVIDER");
    expect(result.sts).toBe("PENDING");
    expect(result.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(result.requestOrigin.client).toBe("TEST_CLIENT");
  });

  it("deve mapear corretamente auth -> item Dynamo em _toItem()", () => {
    const auth = makeAuth();

    const item = repo._toItem(auth);

    expect(item.requestId).toBe("req-auth-123");
    expect(item.signerIdentity).toBe("signer-abc");
    expect(item.provider).toBe("TEST_PROVIDER");
    expect(item.sts).toBe("PENDING");
    expect(item.stsUpdatedAt).toBe(1111111111111);

    expect(item.jti).toBe("jwt-id-001");
    expect(item.expiresInSeconds).toBe(3600);
    expect(item.signerCertificates).toEqual([
      { alias: "cert1", serialNumber: "ABC123" },
    ]);
    expect(item.stampExpiration).toBe(2222222222222);

    expect(item.cached).toBe(false);
    expect(item.environment).toBe("local");
    expect(item.err).toBeNull();
    expect(item.useCache).toBe(true);

    expect(item.requestOrigin).toEqual({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "api-key-id",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    });
  });

  it("deve reconstruir auth a partir de um item Dynamo em _fromItem()", () => {
    const auth = makeAuth();
    const item = repo._toItem(auth);

    const entity = repo._fromItem(item);

    expect(entity.requestId).toBe("req-auth-123");
    expect(entity.signerIdentity).toBe("signer-abc");
    expect(entity.provider).toBe("TEST_PROVIDER");
    expect(entity.sts).toBe("PENDING");
    expect(entity.stsUpdatedAt).toBe(1111111111111);

    expect(entity.jti).toBe("jwt-id-001");
    expect(entity.expiresInSeconds).toBe(3600);
    expect(entity.signerCertificates).toEqual([
      { alias: "cert1", serialNumber: "ABC123" },
    ]);
    expect(entity.stampExpiration).toBe(2222222222222);

    expect(entity.cached).toBe(false);
    expect(entity.environment).toBe("local");
    expect(entity.err).toBeNull();
    expect(entity.useCache).toBe(true);

    expect(entity.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(entity.requestOrigin.client).toBe("TEST_CLIENT");
    expect(entity.requestOrigin.apiKey).toBe("api-key");
    expect(entity.requestOrigin.apiKeyId).toBe("api-key-id");
    expect(entity.requestOrigin.sourceIp).toBe("127.0.0.1");
    expect(entity.requestOrigin.userAgent).toBe("vitest-agent");
  });

  it("deve montar um UpdateExpression correto no update() com campos presentes no partial", async () => {
    sendMock.mockResolvedValueOnce({});

    const partial = {
      sts: "AUTHORIZED",
      cached: true,
      environment: "prod",
    };

    await repo.update("req-auth-123", "signer-abc", partial);

    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    const input = call.input;

    expect(input.TableName).toBe("SignersAuthorizationTableTest");
    expect(input.Key).toEqual({
      requestId: "req-auth-123",
      signerIdentity: "signer-abc",
    });

    const expr = input.UpdateExpression;
    const names = input.ExpressionAttributeNames;
    const values = input.ExpressionAttributeValues;

    // ⚠️ Esses expects vão falhar com a implementação atual,
    // porque o `if` está invertido. Depois você corrige o método
    // update como fizemos no outro repo.
    expect(expr).toContain("#sts = :sts");
    expect(expr).toContain("#cached = :cached");
    expect(expr).toContain("#environment = :environment");
    expect(expr).toContain("#stsUpdatedAt = :stsUpdatedAt");

    expect(names["#sts"]).toBe("sts");
    expect(names["#cached"]).toBe("cached");
    expect(names["#environment"]).toBe("environment");
    expect(names["#stsUpdatedAt"]).toBe("stsUpdatedAt");

    expect(values[":sts"]).toBe("AUTHORIZED");
    expect(values[":cached"]).toBe(true);
    expect(values[":environment"]).toBe("prod");
    expect(typeof values[":stsUpdatedAt"]).toBe("number");
  });

  it("não deve chamar UpdateCommand quando partial estiver vazio", async () => {
    await repo.update("req-auth-123", "signer-abc", {});

    expect(sendMock).not.toHaveBeenCalled();
  });
});
