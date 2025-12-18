import { describe, it, expect } from "vitest";
import { SignatureRequest } from "../../../domain/entities/SignatureRequest";


describe("SignatureRequest", () => {
  it("deve criar uma SignatureRequest via construtor com campos básicos", () => {
    const now = new Date().toISOString();

    const request = new SignatureRequest({
      requestId: "req-123",
      shortId: "short-abc",
      requester: {
        id: "requester-1",
        name: "Cliente X",
      },
      signers: [
        { identity: "11111111111", name: "Fulano" },
        { identity: "22222222222", name: "Beltrano" },
      ],
      // aqui uso o nome que o construtor espera hoje
      unsignedDocumentLocation: {
        bucket: "my-bucket",
        key: "unsigned/file.pdf",
      },
      status: "PENDING",
      provider: "TEST_PROVIDER",
      createdAt: now,
    });

    expect(request.requestId).toBe("req-123");
    expect(request.shortId).toBe("short-abc");
    expect(request.requester).toEqual({
      id: "requester-1",
      name: "Cliente X",
    });
    expect(request.signers).toHaveLength(2);
    expect(request.status).toBe("PENDING");
    expect(request.provider).toBe("TEST_PROVIDER");
    expect(request.createdAt).toBe(now);

    expect(request.unsignedDocumentLocation).toEqual({
      bucket: "my-bucket",
      key: "unsigned/file.pdf",
    });
  });

  it("deve criar uma SignatureRequest via static create com status PENDING e createdAt preenchido", () => {
    const request = SignatureRequest.create({
      requestId: "req-999",
      shortId: "short-xyz",
      requester: {
        id: "requester-2",
        name: "Cliente Y",
      },
      signers: [{ identity: "33333333333", name: "Ciclano" }],
      unsignedDocumentLocation: {
        bucket: "bucket-2",
        key: "docs/doc.pdf",
      },
      provider: "TEST_PROVIDER",
    });

    expect(request.requestId).toBe("req-999");
    expect(request.shortId).toBe("short-xyz");
    expect(request.requester.name).toBe("Cliente Y");
    expect(request.signers).toHaveLength(1);
    expect(request.status).toBe("PENDING");
    expect(request.provider).toBe("TEST_PROVIDER");
    expect(typeof request.createdAt).toBe("string");
    expect(() => new Date(request.createdAt).toISOString()).not.toThrow();
    expect(request.unsignedDocumentLocation).toEqual({
      bucket: "bucket-2",
      key: "docs/doc.pdf",
    });
  });
});
