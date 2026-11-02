import type { TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";

import { prisma } from "../../repositories/prismaClient";
import { LruCache } from "../../utils/lruCache";

export interface TenantRuntimeSnapshot {
  tenant: TenantGroup;
  featureSetting: TenantFeatureSetting | null;
  groupSetting: TenantGroupSetting | null;
}

export class TenantRuntimeCacheService {
  // Cache snapshot tenant selama 45 detik untuk menghindari query SQL berulang pada setiap pesan
  private readonly cache = new LruCache<string, TenantRuntimeSnapshot | null>(500, 45_000);

  /**
   * Mengambil snapshot tenant (tenantGroup + featureSetting + groupSetting)
   * dalam 1 query findUnique SQL. Menggunakan cache memori jika masih valid.
   */
  async getOrFetchSnapshot(groupJid: string): Promise<TenantRuntimeSnapshot | null> {
    const cached = this.cache.get(groupJid);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const tenant = await prisma.tenantGroup.findUnique({
        where: { groupJid },
        include: {
          featureSetting: true,
          groupSetting: true,
        },
      });

      if (!tenant) {
        // Simpan null selama 15 detik untuk menghindari hammering DB pada grup yang belum terdaftar
        this.cache.set(groupJid, null, 15_000);
        return null;
      }

      const snapshot: TenantRuntimeSnapshot = {
        tenant,
        featureSetting: tenant.featureSetting,
        groupSetting: tenant.groupSetting,
      };

      this.cache.set(groupJid, snapshot);
      return snapshot;
    } catch {
      // Jika terjadi error DB, jangan cache failure lama
      return null;
    }
  }

  /**
   * Menghapus cache saat ada perubahan status tenant, perpanjangan sewa, atau pengubahan switch fitur.
   */
  invalidate(groupJid: string): void {
    this.cache.delete(groupJid);
  }

  set(groupJid: string, snapshot: TenantRuntimeSnapshot | null, customTtlMs?: number): void {
    this.cache.set(groupJid, snapshot, customTtlMs);
  }

  /**
   * Menghapus seluruh isi cache.
   */
  clear(): void {
    this.cache.clear();
  }
}

export const tenantRuntimeCacheService = new TenantRuntimeCacheService();
