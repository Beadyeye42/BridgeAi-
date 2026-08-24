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
}) {
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
    throw new Error(isTimeout(error) ? "OPENAI_TIMEOUT" : "OPENAI_NETWORK_ERROR", { cause: error });
  }

  if (!response.ok) throw new Error(responseErrorCode(response.status));

  try {
    return await response.json();
  } catch (error) {
    throw new Error("OPENAI_RESPONSE_INVALID_JSON", { cause: error });
  }
}
