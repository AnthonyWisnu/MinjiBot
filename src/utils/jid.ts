const GROUP_JID_SUFFIX = "@g.us";
const STATUS_BROADCAST_JID = "status@broadcast";
const USER_JID_SUFFIX = "@s.whatsapp.net";
const LID_JID_SUFFIX = "@lid";

export function isGroupJid(jid: string): boolean {
  return jid.endsWith(GROUP_JID_SUFFIX);
}

export function isUserJid(jid: string): boolean {
  return jid.endsWith(USER_JID_SUFFIX) || jid.endsWith(LID_JID_SUFFIX);
}

export function isPhoneUserJid(jid: string): boolean {
  return jid.endsWith(USER_JID_SUFFIX);
}

export function isStatusBroadcastJid(jid: string): boolean {
  return jid === STATUS_BROADCAST_JID;
}

export function getMessageSenderJid(chatJid: string, participantJid?: string | null): string {
  if (isGroupJid(chatJid)) {
    return participantJid ? normalizeJid(participantJid) : chatJid;
  }

  return normalizeJid(chatJid);
}

export function getUniqueNormalizedJids(values: (string | null | undefined)[]): string[] {
  const normalizedJids = values
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .filter(
      (value) => !isGroupJid(normalizeJid(value)) && !isStatusBroadcastJid(normalizeJid(value)),
    )
    .map((value) => normalizeUserJid(value))
    .filter((value) => Boolean(value && value.trim().length > 0));

  return [...new Set(normalizedJids)];
}

export function getPreferredUserJid(jids: string[]): string {
  const phoneJid = jids.find((jid) => isPhoneUserJid(jid));
  const firstJid = jids[0];

  if (phoneJid) {
    return phoneJid;
  }

  if (firstJid) {
    return firstJid;
  }

  throw new Error("JID user tidak tersedia.");
}

export function getIdentityCandidateJids(
  primaryJid: string,
  alternateJids: readonly (string | null | undefined)[] = [],
): string[] {
  return getUniqueNormalizedJids([primaryJid, ...alternateJids]);
}

export function normalizeJid(jid: string): string {
  const normalized = jid.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");

  if (atIndex < 0) {
    return normalized;
  }

  const user = normalized.slice(0, atIndex).replace(/:\d+$/, "");
  const server = normalized.slice(atIndex + 1);

  return `${user}@${server}`;
}

export function normalizePhoneNumberToUserJid(value: string): string {
  const digits = value.replace(/\D/g, "");
  const normalizedDigits = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;

  return `${normalizedDigits}${USER_JID_SUFFIX}`;
}

export function normalizeUserJid(value: string): string {
  if (!value || typeof value !== "string" || !value.trim()) {
    return "";
  }

  const normalized = normalizeJid(value);

  if (
    isGroupJid(normalized) ||
    normalized.endsWith("@broadcast") ||
    normalized.endsWith("@newsletter") ||
    normalized === "status@broadcast"
  ) {
    return "";
  }

  if (isUserJid(normalized)) {
    return normalized;
  }

  const digits = normalized.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  return normalizePhoneNumberToUserJid(normalized);
}

export interface ParticipantOrContactLike {
  id?: string | null;
  phoneNumber?: string | null;
  lid?: string | null;
  jid?: string | null;
}

export interface MessageKeyLike {
  remoteJid?: string | null;
  participant?: string | null;
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
  senderPn?: string | null;
  participantPn?: string | null;
  senderLid?: string | null;
  participantLid?: string | null;
}

export function extractMessageKeyAltJids(key: MessageKeyLike | null | undefined): string[] {
  if (!key) {
    return [];
  }

  return getUniqueNormalizedJids([
    key.remoteJid,
    key.participant,
    key.remoteJidAlt,
    key.participantAlt,
    key.senderPn,
    key.participantPn,
    key.senderLid,
    key.participantLid,
  ]);
}

export function extractContactCandidateJids(
  contact: ParticipantOrContactLike | string | null | undefined,
): string[] {
  if (!contact) {
    return [];
  }

  if (typeof contact === "string") {
    return getIdentityCandidateJids(contact);
  }

  return getIdentityCandidateJids(contact.id ?? "", [
    contact.phoneNumber,
    contact.lid,
    contact.jid,
  ]);
}

export function resolveParticipantWireJid(
  participant: ParticipantOrContactLike | string | null | undefined,
): string {
  if (!participant) {
    return "";
  }

  if (typeof participant === "string") {
    return normalizeJid(participant);
  }

  const candidates = [participant.phoneNumber, participant.jid, participant.id, participant.lid]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .map((value) => normalizeJid(value));

  const phoneJid = candidates.find((value) => isPhoneUserJid(value));
  return phoneJid ?? candidates[0] ?? "";
}

export function getBotCanonicalJids(socket: {
  user?: ParticipantOrContactLike | null;
}): Set<string> {
  const result = new Set<string>();
  if (!socket.user) {
    return result;
  }

  for (const rawValue of [
    socket.user.id,
    socket.user.phoneNumber,
    socket.user.lid,
    socket.user.jid,
  ]) {
    if (!rawValue) {
      continue;
    }

    const rawNormalized = normalizeJid(rawValue);
    if (rawNormalized) {
      result.add(rawNormalized);
      const userJid = normalizeUserJid(rawNormalized);
      if (userJid) {
        result.add(userJid);
      }
    }
  }

  return result;
}

export function isBotUserJid(
  socket: { user?: ParticipantOrContactLike | null } | null | undefined,
  ...candidateJids: (string | null | undefined)[]
): boolean {
  if (!socket) {
    return false;
  }
  const botJids = getBotCanonicalJids(socket);
  if (botJids.size === 0) {
    return false;
  }
  for (const raw of candidateJids) {
    if (!raw) continue;
    const norm = normalizeJid(raw);
    if (norm && botJids.has(norm)) {
      return true;
    }
    const userNorm = normalizeUserJid(raw);
    if (userNorm && botJids.has(userNorm)) {
      return true;
    }
  }
  return false;
}
