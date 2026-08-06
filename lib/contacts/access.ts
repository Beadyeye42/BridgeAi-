import "server-only";
import { prisma, runWithDatabaseIdentity } from "@/lib/db";
import { decryptPrivateValue } from "@/lib/security/encryption";

export async function getUnlockedCustomerContact(input: { quotationId: string; companyId: string; actorUserId: string }) {
  return runWithDatabaseIdentity(input.actorUserId, () => prisma.$transaction(async (tx) => {
    const contacts = await tx.$queryRaw<Array<{
      customerContactId: string;
      displayNameEncrypted: Uint8Array | null;
      phoneEncrypted: Uint8Array;
      emailEncrypted: Uint8Array | null;
    }>>`
      SELECT *
      FROM bridge_private.get_unlocked_customer_contact(${input.quotationId}, ${input.companyId})
    `;
    const contact = contacts[0];
    if (!contact) return null;

    await tx.auditLog.create({ data: {
      actorUserId: input.actorUserId,
      supplierCompanyId: input.companyId,
      action: "CONTACT_ACCESS.VIEWED",
      entityType: "CustomerContact",
      entityId: contact.customerContactId,
      summary: "Supplier viewed customer contact details after quotation selection",
      metadata: { quotationId: input.quotationId },
    } });

    return {
      displayName: contact.displayNameEncrypted ? decryptPrivateValue(contact.displayNameEncrypted) : "Customer",
      phone: decryptPrivateValue(contact.phoneEncrypted),
      email: contact.emailEncrypted ? decryptPrivateValue(contact.emailEncrypted) : null,
    };
  }));
}
