import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMetaTemplate, sendMetaText } from "../lib/whatsapp/meta-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configureMeta() {
  vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "test-token");
  vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "1206623795870723");
  vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
}

describe("Meta outbound client", () => {
  it("sends free-form text through the configured phone-number endpoint", async () => {
    configureMeta();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.sent-1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaText("447700900142", "Your quote is ready")).resolves.toBe("wamid.sent-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/1206623795870723/messages");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-token", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "text", to: "447700900142", text: { preview_url: false } });
  });

  it("uses an approved template payload outside the service window", async () => {
    configureMeta();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.template-1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTemplate({
      to: "447700900142",
      name: "bridge_ai_quote_update",
      language: "en_GB",
      parameters: ["BA-2026-ABC", "Quote 1: £100 — 2 days"],
    })).resolves.toBe("wamid.template-1");
    const payload = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(payload).toMatchObject({
      type: "template",
      template: {
        name: "bridge_ai_quote_update",
        language: { code: "en_GB" },
        components: [{ type: "body" }],
      },
    });
  });

  it("rejects invalid recipients before making a network request", async () => {
    configureMeta();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaText("+44 private", "Hello")).rejects.toThrow("META_RECIPIENT_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains only safe numeric Meta error identifiers", async () => {
    configureMeta();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "Sensitive provider detail that must never be persisted",
        type: "OAuthException",
        code: 100,
        error_subcode: 2494010,
        fbtrace_id: "trace-id",
      },
    }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    let error: unknown;
    try {
      await sendMetaText("447700900142", "Your quote is ready");
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("META_HTTP_400_CODE_100_SUBCODE_2494010");
    expect((error as Error).message).not.toContain("Sensitive provider detail");
    expect((error as Error).message).not.toContain("trace-id");
  });

  it("falls back to an HTTP-only Meta error for non-JSON responses", async () => {
    configureMeta();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream error", { status: 503 })));

    await expect(sendMetaText("447700900142", "Your quote is ready")).rejects.toThrow("META_HTTP_503");
  });
});
