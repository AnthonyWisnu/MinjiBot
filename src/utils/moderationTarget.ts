import type { CommandContext } from "../types/command";
import { normalizePhoneNumberToUserJid, normalizeUserJid } from "./jid";

export interface ExtractTargetOptions {
  allowPhoneArgument?: boolean;
}

export function extractTargetJidFromMessage(
  context: CommandContext,
  options: ExtractTargetOptions = {},
): string | null {
  const rawTarget =
    context.mentionedJids[0] ??
    context.quoted?.participantJid ??
    (options.allowPhoneArgument ? context.args[0] : null) ??
    null;

  if (!rawTarget) {
    return null;
  }

  if (rawTarget.includes("@")) {
    return normalizeUserJid(rawTarget);
  }

  if (options.allowPhoneArgument) {
    return normalizePhoneToJid(rawTarget);
  }

  return null;
}

export function normalizePhoneToJid(value: string): string {
  const digits = value.replace(/\D/g, "");
  const normalizedDigits = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;

  if (!isValidE164PhoneNumber(normalizedDigits)) {
    throw new Error("Nomor tidak valid.");
  }

  return normalizePhoneNumberToUserJid(normalizedDigits);
}

function isValidE164PhoneNumber(value: string): boolean {
  return value.length >= 7 && value.length <= 15;
}
