import { describe, expect, it } from "vitest";
import { loadJSON, memoryStore, removeKey, saveJSON, type KeyValueStore } from "./storage.ts";

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const anyObject = (raw: unknown) => (raw && typeof raw === "object" ? (raw as object) : null);

describe("storage", () => {
  it("round-trips JSON through a store", () => {
    const s = memoryStore();
    expect(saveJSON(s, "k", { a: 1 })).toBe(true);
    expect(loadJSON(s, "k", anyObject)).toEqual({ a: 1 });
  });
  it("returns null for a missing key, missing store, or rejected value", () => {
    const s = memoryStore();
    expect(loadJSON(s, "nope", anyObject)).toBeNull();
    expect(loadJSON(null, "k", anyObject)).toBeNull();
    saveJSON(s, "k", 5);
    expect(loadJSON(s, "k", anyObject)).toBeNull();
  });
  it("returns null for malformed JSON", () => {
    const s = memoryStore();
    s.setItem("k", "{not json");
    expect(loadJSON(s, "k", anyObject)).toBeNull();
  });
  it("never throws when the store throws", () => {
    expect(loadJSON(throwing, "k", anyObject)).toBeNull();
    expect(saveJSON(throwing, "k", 1)).toBe(false);
    expect(saveJSON(null, "k", 1)).toBe(false);
    expect(() => removeKey(throwing, "k")).not.toThrow();
  });
  it("removeKey deletes", () => {
    const s = memoryStore();
    saveJSON(s, "k", 1);
    removeKey(s, "k");
    expect(s.getItem("k")).toBeNull();
  });
});
