import type { GroupMemberTransaction, Prisma } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class GroupMemberTransactionRepository {
  constructor(private readonly client: Client = prisma) {}

  // Buat satu ledger entry. Selalu dipanggil di dalam Prisma transaction dari service layer.
  create(
    data: Prisma.GroupMemberTransactionUncheckedCreateInput,
    tx?: PrismaTransactionClient,
  ): Promise<GroupMemberTransaction> {
    const client = tx ?? this.client;

    return client.groupMemberTransaction.create({ data });
  }

  // Cek apakah idempotency key sudah pernah dipakai. Mengembalikan null jika belum ada.
  findByIdempotencyKey(key: string): Promise<GroupMemberTransaction | null> {
    return this.client.groupMemberTransaction.findUnique({
      where: { idempotencyKey: key },
    });
  }

  // Ambil riwayat transaksi terbaru untuk satu profil member.
  listByProfile(profileId: string, limit = 20): Promise<GroupMemberTransaction[]> {
    return this.client.groupMemberTransaction.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
