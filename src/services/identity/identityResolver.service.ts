import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";

import {
  getBotCanonicalJids,
  isGroupJid,
  isPhoneUserJid,
  normalizeJid,
  normalizeUserJid,
} from "../../utils/jid";

interface CachedMetadata {
  metadata: GroupMetadata;
  expiresAt: number;
}

export class IdentityResolverService {
  private readonly metadataCache = new Map<string, CachedMetadata>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  async getGroupMetadata(
    socket: WASocket,
    groupJid: string,
    forceFresh = false,
  ): Promise<GroupMetadata | null> {
    const normalizedGroupJid = normalizeJid(groupJid);
    if (!isGroupJid(normalizedGroupJid)) {
      return null;
    }

    const cached = this.metadataCache.get(normalizedGroupJid);
    const now = Date.now();
    if (!forceFresh && cached && cached.expiresAt > now) {
      return cached.metadata;
    }

    try {
      if (typeof socket.groupMetadata !== "function") {
        return cached?.metadata ?? null;
      }

      const metadata = await socket.groupMetadata(normalizedGroupJid);
      this.metadataCache.set(normalizedGroupJid, {
        metadata,
        expiresAt: now + this.cacheTtlMs,
      });
      return metadata;
    } catch {
      return cached?.metadata ?? null;
    }

    return cached?.metadata ?? null;
  }

  async resolveCanonicalUserJid(
    socket: WASocket,
    groupJid: string,
    rawJidOrLid: string,
    altJids?: string[],
  ): Promise<string> {
    if (!rawJidOrLid || typeof rawJidOrLid !== "string") {
      return "";
    }

    const normalized = normalizeJid(rawJidOrLid);
    if (isPhoneUserJid(normalized)) {
      return normalizeUserJid(normalized);
    }

    if (altJids && altJids.length > 0) {
      const phoneAlt = altJids.find((j) => isPhoneUserJid(normalizeJid(j)));
      if (phoneAlt) {
        return normalizeUserJid(phoneAlt);
      }
    }

    if (groupJid && isGroupJid(normalizeJid(groupJid))) {
      const metadata = await this.getGroupMetadata(socket, groupJid);
      if (metadata?.participants) {
        const participant = metadata.participants.find(
          (p) =>
            normalizeJid(p.id) === normalized ||
            (p.lid ? normalizeJid(p.lid) === normalized : false) ||
            (p.jid ? normalizeJid(p.jid) === normalized : false),
        );

        if (participant) {
          if (participant.jid && isPhoneUserJid(normalizeJid(participant.jid))) {
            return normalizeUserJid(participant.jid);
          }
          if (participant.id && isPhoneUserJid(normalizeJid(participant.id))) {
            return normalizeUserJid(participant.id);
          }
        }
      }
    }

    return normalizeUserJid(normalized) || normalized;
  }

  getCanonicalCandidateSet(
    first: GroupMetadata | string | null | undefined,
    second?: string | string[] | null,
    third?: string[],
  ): Set<string> {
    const candidates = new Set<string>();

    const addJid = (jid: string | null | undefined) => {
      if (!jid) return;
      const normalized = normalizeJid(jid);
      if (normalized) {
        candidates.add(normalized);
        const userJid = normalizeUserJid(normalized);
        if (userJid) candidates.add(userJid);
      }
    };

    if (first && typeof first === "object" && "participants" in first) {
      // Style 1: (metadata, rawJid)
      const metadata = first;
      const rawJid = typeof second === "string" ? second : "";
      addJid(rawJid);

      const normalized = normalizeJid(rawJid);
      const participant = metadata.participants.find(
        (p) =>
          normalizeJid(p.id) === normalized ||
          (p.lid ? normalizeJid(p.lid) === normalized : false) ||
          (p.jid ? normalizeJid(p.jid) === normalized : false),
      );

      if (participant) {
        addJid(participant.id);
        addJid(participant.lid);
        addJid(participant.jid);
      }
      return candidates;
    }

    // Style 2: (rawJid, altJids, extraAltJids)
    if (typeof first === "string") {
      addJid(first);
    }
    if (typeof second === "string") {
      addJid(second);
    } else if (Array.isArray(second)) {
      second.forEach(addJid);
    }
    if (Array.isArray(third)) {
      third.forEach(addJid);
    }

    return candidates;
  }

  async isGroupMember(socket: WASocket, groupJid: string, rawJid: string): Promise<boolean> {
    const metadata = await this.getGroupMetadata(socket, groupJid);
    if (!metadata?.participants) {
      return false;
    }

    const candidates = this.getCanonicalCandidateSet(metadata, rawJid);
    return metadata.participants.some(
      (p) =>
        candidates.has(normalizeJid(p.id)) ||
        (p.lid ? candidates.has(normalizeJid(p.lid)) : false) ||
        (p.jid ? candidates.has(normalizeJid(p.jid)) : false),
    );
  }

  async isGroupAdmin(
    socket: WASocket,
    groupJid: string,
    rawJid: string,
    altJids?: string[],
  ): Promise<boolean> {
    const metadata = await this.getGroupMetadata(socket, groupJid);
    if (!metadata?.participants) {
      return false;
    }

    const candidates = this.getCanonicalCandidateSet(metadata, rawJid);
    if (altJids) {
      altJids.forEach((j) => {
        for (const c of this.getCanonicalCandidateSet(metadata, j)) {
          candidates.add(c);
        }
      });
    }

    return metadata.participants.some(
      (p) =>
        Boolean(p.admin) &&
        (candidates.has(normalizeJid(p.id)) ||
          (p.lid ? candidates.has(normalizeJid(p.lid)) : false) ||
          (p.jid ? candidates.has(normalizeJid(p.jid)) : false)),
    );
  }

  async isBotGroupAdmin(socket: WASocket, groupJid: string): Promise<boolean> {
    const metadata = await this.getGroupMetadata(socket, groupJid);
    if (!metadata?.participants) {
      return false;
    }

    const botJids = getBotCanonicalJids(socket);
    if (botJids.size === 0) {
      return false;
    }

    return metadata.participants.some(
      (p) =>
        Boolean(p.admin) &&
        (botJids.has(normalizeJid(p.id)) ||
          (p.lid ? botJids.has(normalizeJid(p.lid)) : false) ||
          (p.jid ? botJids.has(normalizeJid(p.jid)) : false)),
    );
  }

  invalidateGroup(groupJid: string): void {
    const normalized = normalizeJid(groupJid);
    this.metadataCache.delete(normalized);
  }
}

export const identityResolverService = new IdentityResolverService();
