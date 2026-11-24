import { describe, expect, it } from "vitest";
import { LruCache } from "./lru.ts";

describe("LruCache", () => {
  it("stores and returns values", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });
  it("evicts the least recently used", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now most recent
    c.set("c", 3); // evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });
  it("overwriting refreshes and doesn't grow", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 9);
    c.set("c", 3); // evicts b, not a
    expect(c.get("a")).toBe(9);
    expect(c.get("b")).toBeUndefined();
  });
  it("capacity is at least 1; clear empties", () => {
    const c = new LruCache<string, number>(0);
    expect(c.capacity).toBe(1);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
  });
});
