import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamoSignaturesCheckRepository } from "../../../infrastructure/repositories/DynamoSignaturesCheckRepository.js";
import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin.js";
import { SignatureCheck } from "../../../domain/entities/SignatureCheck.js";


function makeSignatureCheck(overrides = {}) {
  return new SignatureCheck({
    requestId: "req-check-123",
    signatureRequestId: "req-sign-999",
    signatureShortId: "short-abc",
    checkParameter: {
      subjectAuthorizeParam: true,
      someOtherParam: "VALUE",
    },
    checkResult: {
      status: "PENDING",
      providerStatus: "WAITING",
    },
    requestOrigin: new RequestOrigin({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "key-id-1",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    }),
    ...overrides,
  });
}

describe("DynamoSignaturesCheckRepository", () => {
  let sendMock;
  let repo;

  beforeEach(() => {
    sendMock = vi.fn().mockResolvedValue({});
    const fakeDocClient = { send: sendMock };

    repo = new DynamoSignaturesCheckRepository(
      fakeDocClient,
      "SignaturesCheckTableTest",
    );
  });

  it("deve criar um registro de checagem com create()", async () => {
    const check = makeSignatureCheck();

    await repo.create(check);

    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    expect(call.input.TableName).toBe("SignaturesCheckTableTest");

    const item = call.input.Item;
    expect(item.requestId).toBe("req-check-123");
    expect(item.signatureRequestId).toBe("req-sign-999");
    expect(item.signatureShortId).toBe("short-abc");

    // requestOrigin deve estar serializado em JSON simples
    expect(item.requestOrigin).toEqual({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "key-id-1",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    });
  });

  it("deve retornar null em findByRequestId quando Item não existir", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.findByRequestId("req-nao-existe");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];

    expect(call.input.TableName).toBe("SignaturesCheckTableTest");
    expect(call.input.Key).toEqual({ requestId: "req-nao-existe" });

    expect(result).toBeNull();
  });

  it("deve retornar um SignatureCheck em findByRequestId quando Item existir", async () => {
    const check = makeSignatureCheck();
    const item = repo._toItem(check);

    sendMock.mockResolvedValueOnce({ Item: item });

    const result = await repo.findByRequestId("req-check-123");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];

    expect(call.input.TableName).toBe("SignaturesCheckTableTest");
    expect(call.input.Key).toEqual({ requestId: "req-check-123" });

    expect(result).toBeInstanceOf(SignatureCheck);
    expect(result.requestId).toBe("req-check-123");
    expect(result.signatureRequestId).toBe("req-sign-999");
    expect(result.signatureShortId).toBe("short-abc");
    expect(result.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(result.requestOrigin.client).toBe("TEST_CLIENT");
  });

  it("deve mapear corretamente SignatureCheck para item Dynamo em _toItem()", () => {
    const check = makeSignatureCheck();

    const item = repo._toItem(check);

    expect(item.requestId).toBe("req-check-123");
    expect(item.signatureRequestId).toBe("req-sign-999");
    expect(item.signatureShortId).toBe("short-abc");
    expect(item.checkParameter).toEqual({
      subjectAuthorizeParam: true,
      someOtherParam: "VALUE",
    });
    expect(item.checkResult).toEqual({
      status: "PENDING",
      providerStatus: "WAITING",
    });
    expect(item.requestOrigin).toEqual({
      client: "TEST_CLIENT",
      apiKey: "api-key",
      apiKeyId: "key-id-1",
      sourceIp: "127.0.0.1",
      userAgent: "vitest-agent",
    });
  });

  it("deve reconstruir SignatureCheck a partir de um item Dynamo em _fromItem()", () => {
    const check = makeSignatureCheck();
    const item = repo._toItem(check);

    const entity = repo._fromItem(item);

    expect(entity).toBeInstanceOf(SignatureCheck);
    expect(entity.requestId).toBe("req-check-123");
    expect(entity.signatureRequestId).toBe("req-sign-999");
    expect(entity.signatureShortId).toBe("short-abc");

    expect(entity.checkParameter).toEqual({
      subjectAuthorizeParam: true,
      someOtherParam: "VALUE",
    });
    expect(entity.checkResult).toEqual({
      status: "PENDING",
      providerStatus: "WAITING",
    });

    expect(entity.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(entity.requestOrigin.client).toBe("TEST_CLIENT");
    expect(entity.requestOrigin.apiKey).toBe("api-key");
    expect(entity.requestOrigin.apiKeyId).toBe("key-id-1");
    expect(entity.requestOrigin.sourceIp).toBe("127.0.0.1");
    expect(entity.requestOrigin.userAgent).toBe("vitest-agent");
  });

  it("deve setar requestOrigin como null em _fromItem() quando não existir no item", () => {
    const check = makeSignatureCheck({ requestOrigin: null });
    const item = repo._toItem(check);

    // simula item sem requestOrigin (tipo dado legado ou incompleto)
    delete item.requestOrigin;

    const entity = repo._fromItem(item);

    expect(entity).toBeInstanceOf(SignatureCheck);
    expect(entity.requestOrigin).toBeNull();
  });
});
