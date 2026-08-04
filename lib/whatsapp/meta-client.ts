import "server-only";
import { z } from "zod";
import { metaMessagingCredentials } from "@/lib/config";

const sendResultSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1).max(512) })).min(1).max(5),
});

const metaApiErrorSchema = z.object({
  error: z.object({
    code: z.number().int().nonnegative().optional(),
    error_subcode: z.number().int().nonnegative().optional(),
  }).passthrough(),
}).passthrough();

const mediaMetadataSchema = z.object({
  url: z.string().url(),
  mime_type: z.string().min(1).max(255),
  sha256: z.string().max(255).optional(),
  file_size: z.coerce.number().int().positive().max(20_000_000),
  id: z.string().min(1).max(512),
});

const ALLOWED_MEDIA = new Map([
  ["image/jpeg", { extension: "jpg", maxBytes: 5_000_000 }],
  ["image/png", { extension: "png", maxBytes: 5_000_000 }],
  ["application/pdf", { extension: "pdf", maxBytes: 20_000_000 }],
]);

function graphUrl(path: string) {
  const { graphApiVersion } = metaMessagingCredentials();
  return `https://graph.facebook.com/${graphApiVersion}/${path}`;
}

async function metaFetch(url: string, init?: RequestInit) {
  const { accessToken } = metaMessagingCredentials();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) {
    let providerCode: number | undefined;
    let providerSubcode: number | undefined;
    try {
      const parsed = metaApiErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        providerCode = parsed.data.error.code;
        providerSubcode = parsed.data.error.error_subcode;
      }
    } catch {
      // Meta occasionally returns an empty or non-JSON error response. Keep the
      // stable HTTP-only code in that case and never persist the response body.
    }
    const code = [
      `META_HTTP_${response.status}`,
      providerCode === undefined ? null : `CODE_${providerCode}`,
      providerSubcode === undefined ? null : `SUBCODE_${providerSubcode}`,
    ].filter(Boolean).join("_");
    throw new Error(code);
  }
  return response;
}

export async function sendMetaText(to: string, body: string) {
  const { phoneNumberId } = metaMessagingCredentials();
  if (!/^\d{5,32}$/.test(to)) throw new Error("META_RECIPIENT_INVALID");
  const text = body.trim();
  if (!text || text.length > 4_096) throw new Error("META_TEXT_INVALID");
  const response = await metaFetch(graphUrl(`${phoneNumberId}/messages`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });
  return sendResultSchema.parse(await response.json()).messages[0]!.id;
}

export async function sendMetaTemplate(input: { to: string; name: string; language: string; parameters: string[] }) {
  const { phoneNumberId } = metaMessagingCredentials();
  if (!/^\d{5,32}$/.test(input.to)) throw new Error("META_RECIPIENT_INVALID");
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) throw new Error("META_TEMPLATE_INVALID");
  if (input.parameters.some((value) => !value.trim() || value.length > 4_096)) throw new Error("META_TEMPLATE_PARAMETERS_INVALID");
  const response = await metaFetch(graphUrl(`${phoneNumberId}/messages`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: [{
          type: "body",
          parameters: input.parameters.map((text) => ({ type: "text", text })),
        }],
      },
    }),
  });
  return sendResultSchema.parse(await response.json()).messages[0]!.id;
}

function assertMetaMediaHost(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed = url.protocol === "https:" && ["facebook.com", "fbcdn.net", "fbsbx.com", "whatsapp.net"]
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) throw new Error("META_MEDIA_HOST_REJECTED");
  return url.toString();
}

async function readBounded(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximum) throw new Error("META_MEDIA_TOO_LARGE");
  if (!response.body) throw new Error("META_MEDIA_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("META_MEDIA_TOO_LARGE");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function safeFileName(value: string | undefined, extension: string) {
  const cleaned = value?.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180).trim();
  return cleaned || `customer-upload.${extension}`;
}

export async function downloadMetaMedia(mediaId: string, hintedFileName?: string) {
  if (!/^[a-zA-Z0-9._:-]{1,512}$/.test(mediaId)) throw new Error("META_MEDIA_ID_INVALID");
  const { phoneNumberId } = metaMessagingCredentials();
  const metadataResponse = await metaFetch(graphUrl(`${mediaId}?phone_number_id=${phoneNumberId}`));
  const metadata = mediaMetadataSchema.parse(await metadataResponse.json());
  const rule = ALLOWED_MEDIA.get(metadata.mime_type.toLowerCase());
  if (!rule) throw new Error("META_MEDIA_TYPE_REJECTED");
  if (metadata.file_size > rule.maxBytes) throw new Error("META_MEDIA_TOO_LARGE");
  const mediaResponse = await metaFetch(assertMetaMediaHost(metadata.url));
  const bytes = await readBounded(mediaResponse, rule.maxBytes);
  return {
    bytes,
    mimeType: metadata.mime_type.toLowerCase(),
    fileName: safeFileName(hintedFileName, rule.extension),
    providerSha256: metadata.sha256,
    extension: rule.extension,
  };
}
