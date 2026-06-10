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

export function isStatusBroadcastJid(jid: string): boolean {
  return jid === STATUS_BROADCAST_JID;
}

export function getMessageSenderJid(chatJid: string, participantJid?: string | null): string {
  if (isGroupJid(chatJid)) {
    return participantJid ? normalizeJid(participantJid) : chatJid;
  }

  return normalizeJid(chatJid);
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
  const normalized = normalizeJid(value);

  if (isUserJid(normalized)) {
    return normalized;
  }

  return normalizePhoneNumberToUserJid(normalized);
}
