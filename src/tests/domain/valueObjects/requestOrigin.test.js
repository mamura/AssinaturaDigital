import { describe, expect, it } from "vitest";
import { RequestOrigin } from "../../../domain/valueObjects/RequestOrigin";

describe("RequestOrigin", () => {
  it("deve iniciar comn os valores passados", () => {
    const origin = new RequestOrigin({
      client: "API_CLIENT",
      apiKey: "abc123",
      apiKeyId: "key-id-1",
      sourceIp: "127.0.0.1",
      userAgent: "jest-agent",
    });

    expect(origin.client).toBe("API_CLIENT");
    expect(origin.apiKey).toBe("abc123");
    expect(origin.apiKeyId).toBe("key-id-1");
    expect(origin.sourceIp).toBe("127.0.0.1");
    expect(origin.userAgent).toBe("jest-agent");
  });

  it("deve setar null para campos não informados", () => {
    const origin = new RequestOrigin({});

    expect(origin.client).toBeNull();
    expect(origin.apiKey).toBeNull();
    expect(origin.apiKeyId).toBeNull();
    expect(origin.sourceIp).toBeNull();
    expect(origin.userAgent).toBeNull();
  });

  it("fromRaw deve criar uma instância a partir de um objeto bruto", () => {
    const raw = {
      client: "WEB_CLIENT",
      apiKey: "def456",
      apiKeyId: "key-id-2",
      sourceIp: "192.168.1.1",
      userAgent: "web-agent",
    };

    const origin = RequestOrigin.fromRaw(raw);

    expect(origin).toBeInstanceOf(RequestOrigin);
    expect(origin.client).toBe("WEB_CLIENT");
    expect(origin.apiKey).toBe("def456");
    expect(origin.apiKeyId).toBe("key-id-2");
    expect(origin.sourceIp).toBe("192.168.1.1");
    expect(origin.userAgent).toBe("web-agent");
  });

  it("toJSON deve retornar um objeto literal com os campos corretos", () => {
    const origin = new RequestOrigin({
      client: "MOBILE_CLIENT",
      apiKey: "ghi789",
      apiKeyId: "key-id-3",
      sourceIp: "10.0.0.1",
      userAgent: "mobile-agent",
    });

    const json = origin.toJSON();

    expect(json.client).toBe("MOBILE_CLIENT");
    expect(json.apiKey).toBe("ghi789");
    expect(json.apiKeyId).toBe("key-id-3");
    expect(json.sourceIp).toBe("10.0.0.1");
    expect(json.userAgent).toBe("mobile-agent");
  });
});