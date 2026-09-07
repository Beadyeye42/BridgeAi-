import { describe, expect, it } from "vitest";
import { readBoundedJson } from "@/lib/security/bounded-json";
function chunked(parts: string[], headers?: HeadersInit) {
  return new Request("https://bridge.test", { method: "POST", headers, body: new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  } }), duplex: "half" } as RequestInit);
}
describe("bounded JSON request bodies", () => {
  it("reads valid JSON spanning chunks", async () => {
    await expect(readBoundedJson(chunked(['{"phone":', '"01234567890"}']))).resolves.toEqual({ phone: "01234567890" });
  });
  it.each([undefined, { "content-length": "1" }])("rejects oversized bytes regardless of declared length", async (headers) => {
    await expect(readBoundedJson(chunked(['"', 'a'.repeat(2048), '"'], headers))).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });
  it("counts UTF-8 bytes rather than characters", async () => {
    await expect(readBoundedJson(chunked(['"' + 'é'.repeat(1024) + '"']))).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });
  it("rejects invalid JSON", async () => {
    await expect(readBoundedJson(chunked(['{broken']))).rejects.toThrow();
  });
});
