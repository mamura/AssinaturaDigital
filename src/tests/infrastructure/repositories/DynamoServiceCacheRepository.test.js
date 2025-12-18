import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamoServiceCacheRepository } from "../../../infrastructure/repositories/DynamoServiceCacheRepository.js";
import { ServiceCacheEntry } from "../../../domain/entities/ServiceCacheEntry.js";

describe("DynamoServiceCacheRepository", () => {
  let sendMock;
  let repo;

  beforeEach(() => {
    sendMock = vi.fn().mockResolvedValue({});
    const fakeDocClient = { send: sendMock };

    repo = new DynamoServiceCacheRepository(
      fakeDocClient,
      "ServiceCacheTableTest",
    );
  });

  it("deve retornar null em get() quando nenhum Item for encontrado", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.get("nao-existe");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.input.TableName).toBe("ServiceCacheTableTest");
    expect(call.input.Key).toEqual({ entryKey: "nao-existe" });

    expect(result).toBeNull();
  });

  it("deve retornar um ServiceCacheEntry em get() quando Item existir", async () => {
    const item = {
      entryKey: "config:provider:soluti",
      entryValue: { baseUrl: "https://api.soluti.test", timeout: 5000 },
      createdAt: 1111111111111,
      updatedAt: 2222222222222,
    };

    sendMock.mockResolvedValueOnce({ Item: item });

    const result = await repo.get("config:provider:soluti");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.input.TableName).toBe("ServiceCacheTableTest");
    expect(call.input.Key).toEqual({ entryKey: "config:provider:soluti" });

    expect(result).toBeInstanceOf(ServiceCacheEntry);
    expect(result.entryKey).toBe(item.entryKey);
    expect(result.entryValue).toEqual(item.entryValue);
    expect(result.createdAt).toBe(item.createdAt);
    expect(result.updatedAt).toBe(item.updatedAt);
  });

  it("deve salvar uma entrada no cache com put()", async () => {
    const entry = new ServiceCacheEntry({
      entryKey: "config:provider:soluti",
      entryValue: { baseUrl: "https://api.soluti.test", timeout: 5000 },
      createdAt: 1111111111111,
      updatedAt: 1111111111111,
    });

    await repo.put(entry);

    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    expect(call.input.TableName).toBe("ServiceCacheTableTest");

    const item = call.input.Item;
    expect(item.entryKey).toBe("config:provider:soluti");
    expect(item.entryValue).toEqual({
      baseUrl: "https://api.soluti.test",
      timeout: 5000,
    });
    expect(item.createdAt).toBe(1111111111111);
    expect(item.updatedAt).toBe(1111111111111);
  });

  it("deve atualizar uma entrada existente com update()", async () => {
    const key = "config:provider:soluti";
    const newValue = { baseUrl: "https://api.soluti.prod", timeout: 8000 };

    await repo.update(key, newValue);

    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    const input = call.input;

    expect(input.TableName).toBe("ServiceCacheTableTest");
    expect(input.Key).toEqual({ entryKey: key });

    expect(input.UpdateExpression).toBe(
      "SET #entryValue = :entryValue, #updatedAt = :updatedAt",
    );

    expect(input.ExpressionAttributeNames).toEqual({
      "#entryValue": "entryValue",
      "#updatedAt": "updatedAt",
    });

    expect(input.ExpressionAttributeValues[":entryValue"]).toEqual(newValue);
    expect(typeof input.ExpressionAttributeValues[":updatedAt"]).toBe("number");
  });

  it("deve mapear corretamente ServiceCacheEntry para item Dynamo em _toItem()", () => {
    const entry = new ServiceCacheEntry({
      entryKey: "cache:key",
      entryValue: { foo: "bar" },
      createdAt: 1000,
      updatedAt: 2000,
    });

    const item = repo._toItem(entry);

    expect(item.entryKey).toBe("cache:key");
    expect(item.entryValue).toEqual({ foo: "bar" });
    expect(item.createdAt).toBe(1000);
    expect(item.updatedAt).toBe(2000);
  });

  it("deve reconstruir ServiceCacheEntry a partir de um item Dynamo em _fromItem()", () => {
    const item = {
      entryKey: "cache:key",
      entryValue: { foo: "bar" },
      createdAt: 1000,
      updatedAt: 2000,
    };

    const entry = repo._fromItem(item);

    expect(entry).toBeInstanceOf(ServiceCacheEntry);
    expect(entry.entryKey).toBe("cache:key");
    expect(entry.entryValue).toEqual({ foo: "bar" });
    expect(entry.createdAt).toBe(1000);
    expect(entry.updatedAt).toBe(2000);
  });
});
