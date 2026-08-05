import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { getVerifiedAuthUser } from "@/lib/supabase/verified-user";

const globalForPrisma = globalThis as unknown as { prismaRaw?: PrismaClient };
const identity = new AsyncLocalStorage<string>();

const raw =
  globalForPrisma.prismaRaw ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaRaw = raw;

async function setIdentity(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
  await tx.$executeRaw`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`;
}

async function resolveVerifiedIdentity() {
  const scoped = identity.getStore();
  if (scoped) return scoped;

  // React server continuations can resume outside the scope that loaded the
  // session. Re-verify with Supabase rather than trusting a caller-provided ID.
  const authUser = await getVerifiedAuthUser();
  if (!authUser) {
    throw new Error("A verified Supabase Auth identity is required for database access");
  }
  return authUser.id;
}

const extended = raw.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args }) {
        const userId = await resolveVerifiedIdentity();
        return raw.$transaction(async (tx) => {
          await setIdentity(tx, userId);
          const delegate = (tx as unknown as Record<string, Record<string, (value: unknown) => unknown>>)[model.charAt(0).toLowerCase() + model.slice(1)];
          return delegate[operation](args);
        });
      },
    },
  },
});

export const prisma = new Proxy(extended, {
  get(target, property, receiver) {
    if (property !== "$transaction") return Reflect.get(target, property, receiver);
    return async (callback: (tx: PrismaClient) => unknown, options?: object) => {
      const userId = await resolveVerifiedIdentity();
      return raw.$transaction(async (tx) => {
        await setIdentity(tx, userId);
        return callback(tx as unknown as PrismaClient);
      }, options);
    };
  },
}) as unknown as PrismaClient;

export function runWithDatabaseIdentity<T>(userId: string, work: () => T): T {
  return identity.run(userId, work);
}

export const trustedPrisma = raw;

export type DatabaseWorker = "whatsapp_webhook" | "whatsapp_ai";

export async function runAsDatabaseWorker<T>(
  worker: DatabaseWorker,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return raw.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('bridge_ai.worker_context', ${worker}, true)`;
    return work(tx);
  }, { maxWait: 10_000, timeout: 20_000 });
}
