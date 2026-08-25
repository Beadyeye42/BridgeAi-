import { afterEach, describe, expect, it, vi } from "vitest";
import { openAiConfiguration, openAiCredentials } from "@/lib/config";
import { requestOpenAiResponse } from "@/lib/ai/openai-client";

const original = {
  apiKey: process.env.OPENAI_API_KEY,
  defaultModel: process.env.OPENAI_DEFAULT_MODEL,
  complexModel: process.env.OPENAI_COMPLEX_MODEL,
  routingMode: process.env.OPENAI_ROUTING_MODE,
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, value] of [
    ["OPENAI_API_KEY", original.apiKey],
    ["OPENAI_DEFAULT_MODEL", original.defaultModel],
    ["OPENAI_COMPLEX_MODEL", original.complexModel],
    ["OPENAI_ROUTING_MODE", original.routingMode],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("OpenAI server configuration", () => {
  it("defaults to Luna with deterministic Terra escalation", () => {
    process.env.OPENAI_API_KEY = "test-server-key";
    delete process.env.OPENAI_DEFAULT_MODEL;
    delete process.env.OPENAI_COMPLEX_MODEL;
    delete process.env.OPENAI_ROUTING_MODE;
    expect(openAiConfiguration()).toMatchObject({
      defaultModel: "gpt-5.6-luna",
      complexModel: "gpt-5.6-terra",
      routingMode: "LUNA_WITH_TERRA_ESCALATION",
    });
    expect(openAiCredentials()).toMatchObject({ model: "gpt-5.6-luna" });
  });

  it("accepts official GPT-5.6 API model IDs", () => {
    process.env.OPENAI_API_KEY = "test-server-key";
    process.env.OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_COMPLEX_MODEL = "gpt-5.6-terra";
    expect(openAiConfiguration()).toMatchObject({
      defaultModel: "gpt-5.6-luna",
      complexModel: "gpt-5.6-terra",
    });
  });

  it("rejects a bare Codex desktop profile alias before calling the provider", () => {
    process.env.OPENAI_API_KEY = "test-server-key";
    process.env.OPENAI_DEFAULT_MODEL = "terra";
    expect(() => openAiConfiguration()).toThrow("OPENAI_MODEL_INVALID");
  });
});

describe("OpenAI Responses API failure classification", () => {
  it.each([
    [401, "OPENAI_AUTHENTICATION_FAILED"],
    [403, "OPENAI_PERMISSION_DENIED"],
    [404, "OPENAI_MODEL_NOT_FOUND"],
    [429, "OPENAI_TEMPORARY_FAILURE"],
    [503, "OPENAI_TEMPORARY_FAILURE"],
  ])("maps HTTP %i to %s without exposing provider response text", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret provider detail", { status })));
    await expect(requestOpenAiResponse({ apiKey: "not-logged", body: {}, timeoutMs: 1000, maxRetries: 0 }))
      .rejects.toThrow(code);
  });

  it("returns data and request metadata on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "resp_1", status: "completed" })));
    await expect(requestOpenAiResponse({ apiKey: "not-logged", body: {}, timeoutMs: 1000 }))
      .resolves.toMatchObject({ data: { id: "resp_1", status: "completed" }, attempts: 1 });
  });

  it("retries a temporary failure on the same requested model", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "resp_retry", status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { model: "gpt-5.6-luna", input: "safe test" };

    await expect(requestOpenAiResponse({
      apiKey: "not-logged",
      body,
      timeoutMs: 1000,
      retryDelayMs: 0,
    })).resolves.toMatchObject({ attempts: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(body);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(body);
  });

  it("bounds temporary-failure retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestOpenAiResponse({
      apiKey: "not-logged",
      body: { model: "gpt-5.6-luna" },
      timeoutMs: 1000,
      retryDelayMs: 0,
    })).rejects.toThrow("OPENAI_TEMPORARY_FAILURE");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
