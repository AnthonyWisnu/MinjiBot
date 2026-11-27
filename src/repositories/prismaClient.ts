import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

declare global {
  var minjiPrismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });
}

export const prisma = globalThis.minjiPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.minjiPrismaClient = prisma;
}

export type PrismaTransactionClient = Prisma.TransactionClient;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
