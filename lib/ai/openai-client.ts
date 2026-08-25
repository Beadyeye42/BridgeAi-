import "server-only";

function responseErrorCode(status: number) {
  if (status === 400 || status === 422) return "OPENAI_REQUEST_INVALID";
  if (status === 401) return "OPENAI_AUTHENTICATION_FAILED";
  if (status === 403) return "OPENAI_PERMISSION_DENIED";
  if (status === 404) return "OPENAI_MODEL_NOT_FOUND";
  if (status === 408) return "OPENAI_TIMEOUT";
  if (status === 409 || status === 429 || status >= 500) return "OPENAI_TEMPORARY_FAILURE";
  return "OPENAI_HTTP_ERROR";
}

function isTimeout(error: unknown) {
  return error instanceof Error
    && (error.name === "AbortError" || error.name === "TimeoutError" || /timeout/i.test(error.message));
}

export async function requestOpenAiResponse(input: {
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
}) {
  const startedAt = Date.now();
  const maxRetries = Math.max(0, Math.min(2, input.maxRetries ?? 2));
  let attempts = 0;
  while (attempts <= maxRetries) {
    attempts += 1;
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(input.timeoutMs),
        cache: "no-store",
        body: JSON.stringify(input.body),
      });
    } catch (error) {
      if (attempts <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, (input.retryDelayMs ?? 150) * attempts));
        continue;
      }
      throw new Error(isTimeout(error) ? "OPENAI_TIMEOUT" : "OPENAI_NETWORK_ERROR", { cause: error });
    }

    if (!response.ok) {
      const code = responseErrorCode(response.status);
      if (code === "OPENAI_TEMPORARY_FAILURE" && attempts <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, (input.retryDelayMs ?? 150) * attempts));
        continue;
      }
      throw new Error(code);
    }

    try {
      return { data: await response.json(), latencyMs: Date.now() - startedAt, attempts };
    } catch (error) {
      throw new Error("OPENAI_RESPONSE_INVALID_JSON", { cause: error });
    }
  }
  throw new Error("OPENAI_TEMPORARY_FAILURE");
}
