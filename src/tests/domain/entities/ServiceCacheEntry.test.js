import { describe, it, expect } from "vitest";
import { ServiceCacheEntry } from "../../../domain/entities/ServiceCacheEntry.js";

describe("ServiceCacheEntry", () => {
  it("deve armazenar os campos básicos passados no construtor", () => {
    const entry = new ServiceCacheEntry({
      entryKey: "config:provider:soluti",
      entryValue: { baseUrl: "https://api.soluti.test", timeout: 5000 },
      createdAt: 1111111111111,
      updatedAt: 2222222222222,
    });

    expect(entry.entryKey).toBe("config:provider:soluti");
    expect(entry.entryValue).toEqual({
      baseUrl: "https://api.soluti.test",
      timeout: 5000,
    });
    expect(entry.createdAt).toBe(1111111111111);
    expect(entry.updatedAt).toBe(2222222222222);
  });

  it("pode aceitar createdAt/updatedAt não definidos e deixar a lógica para fora", () => {
    const entry = new ServiceCacheEntry({
      entryKey: "config:test",
      entryValue: { foo: "bar" },
    });

    expect(entry.entryKey).toBe("config:test");
    expect(entry.entryValue).toEqual({ foo: "bar" });
    // não afirmo nada sobre createdAt/updatedAt porque quem resolve default é o repo (_toItem)
  });
});
