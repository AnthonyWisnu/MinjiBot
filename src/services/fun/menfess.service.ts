import { TenantStatus, type TenantGroup } from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { formatRemainingDuration } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { MENFESS_COOLDOWN_MS } from "../rpg/cooldownCatalog";

export { MENFESS_COOLDOWN_MS };
export const MENFESS_MIN_CHARS = 3;
export const MENFESS_MAX_CHARS = 500;
const MAX_COOLDOWN_ENTRIES = 2_000;

const BLOCKED_LINK_REGEX =
  /(https?:\/\/|www\.|chat\.whatsapp\.com|wa\.me\/|t\.me\/|bit\.ly\/|tinyurl\.com\/|discord\.gg\/)/i;
const EXCESSIVE_REPEAT_REGEX = /(.)\1{14,}/;

export interface MenfessDispatchPlan {
  tenantGroup: TenantGroup;
  targetUserJid: string | null;
  cleanedMessage: string;
  formattedGroupCard: string;
  mentions: string[];
}

interface MenfessTenantStore {
  findByTenantCode(tenantCode: string): Promise<TenantGroup | null>;
}

interface MenfessMemberStore {
  findByGroupAndUser(groupJid: string, userJid: string): Promise<unknown>;
}

export class MenfessService {
  private readonly userCooldowns = new Map<string, number>();

  constructor(
    private readonly tenantRepo: MenfessTenantStore = new TenantGroupRepository(),
    private readonly memberRepo: MenfessMemberStore = new GroupMemberProfileRepository(),
  ) {}

  async prepareGroupMenfess(input: {
    senderCandidateJids: readonly string[];
    isSuperOwner: boolean;
    tenantCode: string;
    rawMessage: string;
    targetPhoneDigits?: string | null;
    groupParticipantJids?: readonly string[];
    resolveGroupParticipants?: (groupJid: string) => Promise<readonly string[]>;
    now?: Date;
  }): Promise<MenfessDispatchPlan> {
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const code = input.tenantCode.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_-]{3,20}$/.test(code)) {
      throw new AppUserError("Kode grup tidak valid. Cek kode grup dengan mengetik .menfess di grup.");
    }

    const senderKey = normalizeUserJid(input.senderCandidateJids[0] ?? "");
    if (!input.isSuperOwner && senderKey) {
      const lastSent = this.userCooldowns.get(senderKey);
      if (lastSent !== undefined && nowMs - lastSent < MENFESS_COOLDOWN_MS) {
        const rem = MENFESS_COOLDOWN_MS - (nowMs - lastSent);
        throw new AppUserError(
          `Kamu baru mengirim menfess. Tunggu *${formatRemainingDuration(rem)}* lagi biar grup tidak spam.`,
        );
      }
    }

    const cleanedMessage = input.rawMessage.trim();
    if (cleanedMessage.length < MENFESS_MIN_CHARS) {
      throw new AppUserError(`Pesan menfess minimal ${String(MENFESS_MIN_CHARS)} karakter ya.`);
    }
    if (cleanedMessage.length > MENFESS_MAX_CHARS) {
      throw new AppUserError(`Pesan menfess maksimal ${String(MENFESS_MAX_CHARS)} karakter.`);
    }
    if (BLOCKED_LINK_REGEX.test(cleanedMessage)) {
      throw new AppUserError("Pesan menfess dilarang mengandung tautan/link demi keamanan grup.");
    }
    if (EXCESSIVE_REPEAT_REGEX.test(cleanedMessage)) {
      throw new AppUserError("Pesan menfess terdeteksi spam karakter berulang.");
    }

    const tenantGroup = await this.tenantRepo.findByTenantCode(code);
    if (!tenantGroup) {
      throw new AppUserError(`Grup dengan kode *${code}* tidak ditemukan.`);
    }
    if (
      tenantGroup.isBlocked ||
      tenantGroup.status !== TenantStatus.ACTIVE ||
      (tenantGroup.expiresAt !== null && tenantGroup.expiresAt.getTime() <= nowMs)
    ) {
      throw new AppUserError(`Grup *${code}* sedang tidak aktif atau masa sewanya habis.`);
    }

    // Verifikasi pengirim adalah anggota grup agar orang asing tidak bisa spam menfess
    if (!input.isSuperOwner) {
      const normalizedCandidates = input.senderCandidateJids
        .map((j) => normalizeUserJid(j))
        .filter(Boolean);
      let isMember = false;

      let participantJids = input.groupParticipantJids;
      if ((!participantJids || participantJids.length === 0) && input.resolveGroupParticipants) {
        try {
          participantJids = await input.resolveGroupParticipants(tenantGroup.groupJid);
        } catch {
          participantJids = undefined;
        }
      }

      if (participantJids && participantJids.length > 0) {
        const participantSet = new Set(
          participantJids.map((j) => normalizeUserJid(j)).filter(Boolean),
        );
        isMember = normalizedCandidates.some((c) => participantSet.has(c));
      }

      if (!isMember) {
        for (const jid of normalizedCandidates) {
          const prof = await this.memberRepo.findByGroupAndUser(tenantGroup.groupJid, jid);
          if (prof) {
            isMember = true;
            break;
          }
        }
      }

      if (!isMember) {
        throw new AppUserError(
          `Kamu harus menjadi anggota aktif di grup *${code}* untuk mengirim menfess ke grup tersebut.`,
        );
      }
    }

    let targetUserJid: string | null = null;
    const mentions: string[] = [];
    if (input.targetPhoneDigits && /^\d{8,16}$/.test(input.targetPhoneDigits)) {
      targetUserJid = normalizeUserJid(`${input.targetPhoneDigits}@s.whatsapp.net`);
      mentions.push(targetUserJid);
    }

    const targetHeader = targetUserJid
      ? `Untuk : @${targetUserJid.split("@")[0] ?? targetUserJid}`
      : "Untuk : Seluruh Warga Grup";

    const formattedGroupCard = [
      "*── [ MENFESS ANONIM ] ──*",
      "Dari  : Rahasia",
      targetHeader,
      "",
      `"${cleanedMessage}"`,
      "",
      `_Mau kirim pesan rahasia juga? DM bot: .menfess ${tenantGroup.tenantCode} <pesan>_`,
    ].join("\n");

    return {
      tenantGroup,
      targetUserJid,
      cleanedMessage,
      formattedGroupCard,
      mentions,
    };
  }

  getRemainingCooldownMs(senderJid: string, nowMs = Date.now()): number {
    const key = normalizeUserJid(senderJid);
    if (!key) return 0;
    const lastSent = this.userCooldowns.get(key);
    if (lastSent === undefined) return 0;
    const elapsed = nowMs - lastSent;
    return elapsed >= MENFESS_COOLDOWN_MS ? 0 : MENFESS_COOLDOWN_MS - elapsed;
  }

  recordSent(senderJid: string, nowMs = Date.now()): void {
    const key = normalizeUserJid(senderJid);
    if (!key) return;
    this.userCooldowns.set(key, nowMs);
    if (this.userCooldowns.size > MAX_COOLDOWN_ENTRIES) {
      for (const [k, ts] of this.userCooldowns.entries()) {
        if (nowMs - ts > MENFESS_COOLDOWN_MS * 2) {
          this.userCooldowns.delete(k);
        }
      }
      while (this.userCooldowns.size > MAX_COOLDOWN_ENTRIES) {
        const oldest = this.userCooldowns.keys().next().value;
        if (!oldest) break;
        this.userCooldowns.delete(oldest);
      }
    }
  }
}

export const menfessService = new MenfessService();
