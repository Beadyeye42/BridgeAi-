import "server-only";
import { prisma, trustedPrisma } from "@/lib/db";
import { decryptPrivateValue } from "@/lib/security/encryption";

export async function getUnlockedCustomerContact(input: { quotationId: string; companyId: string; actorUserId: string }) {
  const grant = await prisma.contactAccessGrant.findFirst({
    where: { quotationId: input.quotationId, supplierCompanyId: input.companyId, revokedAt: null },
  });
  if (!grant) return null;
  const contact = await trustedPrisma.customerContact.findUniqueOrThrow({ where: { id: grant.customerContactId } });
  await trustedPrisma.auditLog.create({ data: {
    actorUserId: input.actorUserId,
    supplierCompanyId: input.companyId,
    action: "CONTACT_ACCESS.VIEWED",
    entityType: "CustomerContact",
    entityId: contact.id,
    summary: "Supplier viewed payment-unlocked customer contact details",
    metadata: { quotationId: input.quotationId, grantId: grant.id },
  } });
  return {
    displayName: contact.displayNameEncrypted ? decryptPrivateValue(contact.displayNameEncrypted) : "Customer",
    phone: decryptPrivateValue(contact.phoneEncrypted),
    email: contact.emailEncrypted ? decryptPrivateValue(contact.emailEncrypted) : null,
  };
}
