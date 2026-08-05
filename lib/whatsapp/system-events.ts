import "server-only";
import { Prisma } from "@prisma/client";

export async function writeWhatsAppSystemEvent(
  tx: Prisma.TransactionClient,
  worker: "whatsapp_webhook" | "whatsapp_ai",
  data: {
    severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
    code: string;
    message: string;
    context?: Prisma.InputJsonValue;
  },
) {
  await tx.$queryRaw`
    SELECT bridge_private.write_whatsapp_system_event(
      ${data.severity}::bridge_ai."SystemEventSeverity",
      ${worker},
      ${data.code},
      ${data.message},
      ${JSON.stringify(data.context ?? {})}::jsonb
    )
  `;
}
