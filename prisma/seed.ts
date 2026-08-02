import { trustedPrisma } from "../lib/db";
import { getSupabaseAdmin } from "../lib/supabase/server";

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEVELOPMENT_SEED !== "true") {
    throw new Error("Development seeding is disabled. Set ALLOW_DEVELOPMENT_SEED=true outside production.");
  }
  const email = process.env.SEED_SUPPLIER_EMAIL;
  const password = process.env.SEED_SUPPLIER_PASSWORD;
  if (!email || !password) throw new Error("SEED_SUPPLIER_EMAIL and SEED_SUPPLIER_PASSWORD are required");

  const admin = getSupabaseAdmin();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Seed Auth user was not created");
  try {
    await trustedPrisma.$queryRaw`
      SELECT bridge_private.bootstrap_supplier(
        ${created.data.user.id}::uuid, ${email}, 'Demo', 'Supplier',
        'Bridge AI Demonstration Supplier', '+44 0000 000000', 'development-seed'
      )
    `;
  } catch (error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    throw error;
  }
  console.info(`Development supplier created: ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => trustedPrisma.$disconnect());
