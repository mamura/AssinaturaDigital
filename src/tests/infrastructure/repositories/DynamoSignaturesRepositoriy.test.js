import { beforeEach, describe, expect, it, vi } from "vitest";
import { Signature } from "../../../domain/entities/Signature";
import { DynamoSignaturesRepository } from "../../../infrastructure/repositories/DynamoSignaturesRepository";
import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin";
import { ExportConflictException } from "@aws-sdk/client-dynamodb";

function makeSignature(overrides = {}) {
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

    requestOrigin: new RequestOrigin({
      client: "TEST_CLIENT",
      apiKey: "key",
      apiKeyId: "id",
      sourceIp: "127.0.0.1",
      userAgent: "vitest",
    }),

    ...overrides,
  });
}

describe("DynamoSygnaturesRepository", () => {
  let sendMock;
  let repo;

  beforeEach(() => {
    sendMock            = vi.fn().mockResolvedValue({});
    const fakeDocClient = { send: sendMock };
    repo                = new DynamoSignaturesRepository(fakeDocClient, "SignaturesTableTest");
  });

  it("deve criar uma assinatura chamando docClient.send com PutCommand", async () => {
    const signature = makeSignature();

    await repo.create(signature);

    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    expect(call.input.TableName).toBe("SignaturesTableTest");

    const item = call.input.Item;
    expect(item.requestId).toBe("req-123");
    expect(item.signerIdentity).toBe("signer-001");
    expect(item.shortId).toBe("short-abc");
    expect(item.requestOrigin).toEqual({
      client: "TEST_CLIENT",
      apiKey: "key",
      apiKeyId: "id",
      sourceIp: "127.0.0.1",
      userAgent: "vitest", 
    });
  });

  it("deve retornar null em findRequestIdAndSigner quando item nõo existir", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.findByRequestIdAndSigner("req-404", "signer-404");

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("deve carregar uma assinatura em findRequestIdAndSigner quando Item existir", async () => {
    const signature = makeSignature();
    const dynamoItem = repo._toItem(signature);

    sendMock.mockResolvedValueOnce({ Item: dynamoItem });

    const result = await repo.findByRequestIdAndSigner("req-123", "signer-001");

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Signature);
    expect(result.requestId).toBe("req-123");
    expect(result.signerIdentity).toBe("signer-001");
    expect(result.shortId).toBe("short-abc");
    expect(result.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(result.requestOrigin.client).toBe("TEST_CLIENT");
  });

  it("deve buscar por shortId usando o índice signatureShortIndex", async () => {
    const signature   = makeSignature({ shortId: "short-xyz" });
    const dynamoItem  = repo._toItem(signature);

    sendMock.mockResolvedValueOnce({ Items: [dynamoItem] });

    const result = await repo.findByShortId("short-xyz");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.input.IndexName).toBe("signatureShortIdIndex");
    expect(call.input.KeyConditionExpression).toContain("shortId");
    expect(call.input.ExpressionAttributeValues[":shortId"]).toBe("short-xyz");

    expect(result).toBeInstanceOf(Signature);
    expect(result.shortId).toBe("short-xyz");
  });

  it("deve retornar null em findByShortId quando nenhuma assinatura for encontrada", async () => {
    sendMock.mockResolvedValueOnce({ Items: [] });

    const result = await repo.findByShortId("not-found");

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("deve montar um UpdateExpression correto no update com campos presentes no partial", async () => {
    sendMock.mockResolvedValueOnce({});

    const partial = {
      sts: "DONE",
      requesterCallbackSts: "DELIVERED",
      signerCertificateAlias: "alias-123",
    };

    await repo.update("req-123", "signer-001", partial);
    
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];

    expect(call.input.TableName).toBe("SignaturesTableTest");
    expect(call.input.Key).toEqual({
      requestId: "req-123",
      signerIdentity: "signer-001",
    });

    const expr    = call.input.UpdateExpression;
    const names   = call.input.ExpressionAttributeNames;
    const values  = call.input.ExpressionAttributeValues;

    // Confere se os campos do partial entraram na expressão
    expect(expr).toContain("#sts = :sts");
    expect(expr).toContain("#requesterCallbackSts = :requesterCallbackSts");
    expect(expr).toContain("#signerCertificateAlias = :signerCertificateAlias");

    // E se os campos de controle de data também aparecem
    expect(expr).toContain("#stsUpdatedAt = :stsUpdatedAt");
    expect(expr).toContain("#requesterCallbackStsUpdatedAt = :requesterCallbackStsUpdatedAt");

    expect(names["#sts"]).toBe("sts");
    expect(names["#requesterCallbackSts"]).toBe("requesterCallbackSts");
    expect(names["#signerCertificateAlias"]).toBe("signerCertificateAlias");

    expect(values[":sts"]).toBe("DONE");
    expect(values[":requesterCallbackSts"]).toBe("DELIVERED");
    expect(values[":signerCertificateAlias"]).toBe("alias-123");
    expect(typeof values[":stsUpdatedAt"]).toBe("number");
    expect(typeof values[":requesterCallbackStsUpdatedAt"]).toBe("number");
  });

  it("não deve chamar UpdateCommand se nenhum campo atualizável for passado", async () => {
    await repo.update("req-123", "signer-001", {});

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deve mapear corretamente Signature para item Dynamo em _toItem", () => {
    const signature = makeSignature();
    const item      = repo._toItem(signature);

    expect(item.requestId).toBe("req-123");
    expect(item.shortId).toBe("short-abc");
    expect(item.signerIdentity).toBe("signer-001");

    expect(item.provider).toBe("TEST_PROVIDER");
    expect(item.environment).toBe("local");
    expect(item.sts).toBe("PENDING");

    // unsignedDocument / signedDocument simples
    expect(item.unsignedDocument).toEqual({
      fileName: "file.pdf",
      size: 1234,
      contentType: "application/pdf",
    });
    expect(item.signedDocument).toBeNull();

    // requestOrigin deve ser um JSON plain, não um ValueObject
    expect(item.requestOrigin).toEqual({
      client: "TEST_CLIENT",
      apiKey: "key",
      apiKeyId: "id",
      sourceIp: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(typeof item.requestOrigin).toBe("object");
    expect(item.requestOrigin.constructor).toBe(Object);
  });

  it("deve reconstruir uma Signature a partir de um item Dynamo em _fromItem", () => {
    const originalSignature = makeSignature();
    const item = repo._toItem(originalSignature);
    const entity = repo._fromItem(item);

    expect(entity).toBeInstanceOf(Signature);
    expect(entity.requestId).toBe(originalSignature.requestId);
    expect(entity.shortId).toBe(originalSignature.shortId);
    expect(entity.signerIdentity).toBe(originalSignature.signerIdentity);
    expect(entity.provider).toBe(originalSignature.provider);
    expect(entity.environment).toBe(originalSignature.environment);
    expect(entity.sts).toBe(originalSignature.sts);

    // Unsigned document
    expect(entity.unsignedDocument).toEqual(originalSignature.unsignedDocument);
    expect(entity.signedDocument).toBe(originalSignature.signedDocument);

    // RequestOrigin volta como ValueObject
    expect(entity.requestOrigin).toBeInstanceOf(RequestOrigin);
    expect(entity.requestOrigin.client).toBe("TEST_CLIENT");
    expect(entity.requestOrigin.apiKey).toBe("key");
    expect(entity.requestOrigin.apiKeyId).toBe("id");
    expect(entity.requestOrigin.sourceIp).toBe("127.0.0.1");
    expect(entity.requestOrigin.userAgent).toBe("vitest");
  });

  it("deve setar requestOrigin como null em _fromItem quando não houver campo no item", () => {
    const originalSignature = makeSignature({ requestOrigin: null });
    const item = repo._toItem(originalSignature);

    // Força a remoção do campo do item para simular dado legado/incompleto
    delete item.requestOrigin;

    const entity = repo._fromItem(item);

    expect(entity).toBeInstanceOf(Signature);
    expect(entity.requestOrigin).toBeNull();
  });

});