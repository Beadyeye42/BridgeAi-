import { afterEach, describe, expect, it, vi } from "vitest";
import { openAiCredentials } from "@/lib/config";
import { requestOpenAiResponse } from "@/lib/ai/openai-client";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = originalModel;
});

describe("OpenAI server configuration", () => {
  it("defaults to the balanced GPT-5.6 Terra API model", () => {
    process.env.OPENAI_API_KEY = "test-server-key";
    delete process.env.OPENAI_MODEL;
    expect(openAiCredentials()).toMatchObject({ model: "gpt-5.6-terra" });
  });

  it("accepts the official GPT-5.6 Terra API model ID", () => {
    process.env.OPENAI_API_KEY = "test-server-key";
    process.env.OPENAI_MODEL = "gpt-5.6-terra";
    expect(openAiCredentials()).toMatchObject({ model: "gpt-5.6-terra" });
  });

  it("rejects a bare Codex desktop profile alias before calling the provider", () => {
    process.env.OPENAI_API_KEY = "test-server-key";
    process.env.OPENAI_MODEL = "terra";
    expect(() => openAiCredentials()).toThrow("OPENAI_MODEL_INVALID");
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
    await expect(requestOpenAiResponse({ apiKey: "not-logged", body: {}, timeoutMs: 1000 }))
      .rejects.toThrow(code);
  });

  it("returns parsed structured response data on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "resp_1", status: "completed" })));
    await expect(requestOpenAiResponse({ apiKey: "not-logged", body: {}, timeoutMs: 1000 }))
      .resolves.toEqual({ id: "resp_1", status: "completed" });
  });
});
