import { TenantAuditAction, type TenantFeatureSetting, type TenantGroup } from "@prisma/client";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { tenantOwnerSessionService } from "./tenantOwnerSession.service";
import type { Role } from "../../types/role";
import type { TenantFeatureKey } from "../../types/feature";

const FEATURE_SETTING_FIELD = {
  downloader: "downloaderEnabled",
  hd: "hdEnabled",
  game: "gameEnabled",
  welcome: "welcomeEnabled",
  antilink: "antiLinkEnabled",
  antispam: "antiSpamEnabled",
  reminder: "reminderEnabled",
  tagall: "tagAllEnabled",
  antidelete: "antiDeleteEnabled",
  antiviewonce: "antiViewOnceEnabled",
} as const satisfies Record<TenantFeatureKey, keyof TenantFeatureSetting>;

export interface UpdateTenantFeatureInput {
  actorJid: string;
  actorRole: Role;
  tenantGroup: TenantGroup;
  feature: TenantFeatureKey;
  enabled: boolean;
}

export interface ResolveFeatureTenantInput {
  actorJid: string;
  actorRole: Role;
  tenantGroup?: TenantGroup;
  isGroup: boolean;
}

export class TenantFeatureService {
  constructor(private readonly tenantFeatureRepository = new TenantFeatureRepository()) {}

  async getFeatureSetting(groupJid: string): Promise<TenantFeatureSetting> {
    return this.tenantFeatureRepository.ensureForGroup(groupJid);
  }

  async isFeatureEnabled(groupJid: string, feature: TenantFeatureKey): Promise<boolean> {
    const setting = await this.tenantFeatureRepository.ensureForGroup(groupJid);
    const field = FEATURE_SETTING_FIELD[feature];

    return setting[field];
  }

  async updateFeature(input: UpdateTenantFeatureInput): Promise<TenantFeatureSetting> {
    this.assertCanManageFeature(input.actorRole);

    if (input.actorRole === "TENANT_OWNER" && input.tenantGroup.ownerJid !== input.actorJid) {
      throw new Error("Kamu tidak dapat mengatur tenant milik owner lain.");
    }

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const field = FEATURE_SETTING_FIELD[input.feature];
      const setting = await tenantFeatureRepository.ensureForGroup(input.tenantGroup.groupJid);
      const updatedSetting = await tenantFeatureRepository.update(input.tenantGroup.groupJid, {
        [field]: input.enabled,
      });

      if (setting[field] !== input.enabled) {
        await tenantAuditRepository.create({
          groupJid: input.tenantGroup.groupJid,
          actorJid: input.actorJid,
          action: TenantAuditAction.FEATURE_UPDATED,
          metadata: {
            feature: input.feature,
            enabled: input.enabled,
            tenantCode: input.tenantGroup.tenantCode,
          },
        });
      }

      return updatedSetting;
    });
  }

  async resolveManagedTenant(input: ResolveFeatureTenantInput): Promise<TenantGroup> {
    if (input.isGroup) {
      if (!input.tenantGroup) {
        throw new Error("Tenant grup tidak ditemukan.");
      }

      this.assertCanManageFeature(input.actorRole);
      return input.tenantGroup;
    }

    if (input.actorRole !== "TENANT_OWNER") {
      throw new Error("Pengaturan fitur private membutuhkan selected tenant Tenant Owner.");
    }

    const currentTenant = await tenantOwnerSessionService.getCurrentTenant(input.actorJid);
    if (!currentTenant.tenantGroup) {
      throw new Error(
        currentTenant.expired
          ? "Session tenant kamu sudah expired. Gunakan .mytenant lalu .usetenant <nomor/kode>."
          : "Pilih tenant dulu dengan .mytenant lalu .usetenant <nomor/kode>.",
      );
    }

    return currentTenant.tenantGroup;
  }

  parseFeatureKey(value: string): TenantFeatureKey {
    const normalized = value.trim().toLowerCase();

    if (normalized === "anti-link") {
      return "antilink";
    }

    if (normalized === "anti-spam") {
      return "antispam";
    }

    if (normalized === "tag-all") {
      return "tagall";
    }

    if (isTenantFeatureKey(normalized)) {
      return normalized;
    }

    throw new Error("Nama fitur tidak dikenal.");
  }

  parseFeatureEnabled(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    if (normalized === "on" || normalized === "enable" || normalized === "enabled") {
      return true;
    }

    if (normalized === "off" || normalized === "disable" || normalized === "disabled") {
      return false;
    }

    throw new Error("Status fitur harus on atau off.");
  }

  private assertCanManageFeature(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command ini hanya dapat digunakan oleh pengelola tenant.");
  }
}

function isTenantFeatureKey(value: string): value is TenantFeatureKey {
  return [
    "downloader",
    "hd",
    "game",
    "welcome",
    "antilink",
    "antispam",
    "reminder",
    "tagall",
  ].includes(value);
}

export const tenantFeatureService = new TenantFeatureService();
