import { downloadMediaMessage, proto, type WAMessageKey } from "@whiskeysockets/baileys";

import { AppUserError } from "../../errors/appUserError";
import {
  baileysNativeService,
  buildOwnerVCard,
  buildVCard,
  parseEphemeralDurationSeconds,
  parseEventCommandInput,
  parsePinDurationSeconds,
} from "../../services/group/baileysNative.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { getBotCanonicalJids, normalizeUserJid } from "../../utils/jid";
import { resolveImageMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const MAX_GROUP_PHOTO_BYTES = 5 * 1024 * 1024;

async function ensureActiveGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di dalam grup aktif.");
    return false;
  }
  return true;
}

async function ensureGroupAdminAndBotAdmin(context: CommandContext): Promise<boolean> {
  if (!(await ensureActiveGroup(context))) return false;

  const isWaAdmin = await identityResolverService.isGroupAdmin(
    context.socket,
    context.chatJid,
    context.senderJid,
    context.senderAltJids,
  );
  const canManage =
    isWaAdmin ||
    context.role === "SUPER_OWNER" ||
    context.role === "TENANT_OWNER" ||
    context.role === "TENANT_ADMIN";
  if (!canManage) {
    await context.reply("Perintah ini hanya dapat digunakan oleh Admin Grup atau Owner.");
    return false;
  }

  const botJids = Array.from(getBotCanonicalJids(context.socket));
  const botPrimary = botJids[0];
  const isBotAdmin = botPrimary
    ? await identityResolverService.isGroupAdmin(context.socket, context.chatJid, botPrimary, botJids)
    : false;
  if (!isBotAdmin) {
    await context.reply("Jadikan bot sebagai Admin Grup terlebih dahulu agar fitur ini dapat dijalankan.");
    return false;
  }

  return true;
}

function buildQuotedMessageKey(context: CommandContext): WAMessageKey | null {
  if (!context.quoted?.id) {
    return null;
  }
  const botJids = getBotCanonicalJids(context.socket);
  const isFromMe = context.quoted.participantJid
    ? botJids.has(normalizeUserJid(context.quoted.participantJid))
    : false;
  return {
    remoteJid: context.chatJid,
    id: context.quoted.id,
    participant: context.quoted.participantJid,
    fromMe: isFromMe,
  };
}

// ==================== 1. EVENT CARD NATIVE WA ====================

async function handleBuatEvent(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  try {
    const parsed = parseEventCommandInput(context.argsText);
    await context.socket.sendMessage(
      context.chatJid,
      {
        event: {
          name: parsed.title,
          description: parsed.description,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          ...(parsed.locationName
            ? { location: { name: parsed.locationName, address: parsed.locationName } }
            : {}),
          extraGuestsAllowed: true,
          isCancelled: false,
        },
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat Kartu Event WhatsApp."));
  }
}

// ==================== 2. PIN & UNPIN NATIVE ====================

async function handlePinPesan(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;
  const targetKey = buildQuotedMessageKey(context);
  if (!targetKey) {
    await context.reply("Reply pesan yang ingin di-pin dengan *.pinpesan [24j|7h|30h]*");
    return;
  }

  try {
    const duration = parsePinDurationSeconds(context.args[0]);
    await context.socket.sendMessage(context.chatJid, {
      pin: targetKey,
      type: proto.PinInChat.Type.PIN_FOR_ALL,
      time: duration,
    });
    const label = duration === 86400 ? "24 jam" : duration === 604800 ? "7 hari" : "30 hari";
    await context.reply(`Pesan berhasil disematkan (Pin) di grup untuk *${label}*.`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menyematkan pesan di grup."));
  }
}

async function handleUnpinPesan(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;
  const targetKey = buildQuotedMessageKey(context);
  if (!targetKey) {
    await context.reply("Reply pesan yang sedang di-pin dengan *.unpinpesan* untuk melepas pin.");
    return;
  }

  try {
    await context.socket.sendMessage(context.chatJid, {
      pin: targetKey,
      type: proto.PinInChat.Type.UNPIN_FOR_ALL,
    });
    await context.reply("Pin pesan berhasil dilepas.");
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melepas pin pesan."));
  }
}

// ==================== 3. REACTION EMOJI NATIVE ====================

async function handleReact(context: CommandContext): Promise<void> {
  const rawEmoji = context.args[0]?.trim() ?? "";
  if (!rawEmoji) {
    await context.reply("Reply sebuah pesan lalu ketik *.react <emoji>* (atau *.react hapus*).");
    return;
  }

  const clear = rawEmoji.toLowerCase() === "hapus" || rawEmoji.toLowerCase() === "off";
  if (!clear && rawEmoji.length > 16) {
    await context.reply("Masukkan 1 emoji reaksi saja. Contoh: *.react 🔥*");
    return;
  }

  const targetKey = buildQuotedMessageKey(context) ?? context.message.key;
  try {
    await context.socket.sendMessage(context.chatJid, {
      react: {
        text: clear ? "" : rawEmoji,
        key: targetKey,
      },
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengirim reaksi emoji."));
  }
}

// ==================== 4. LOKASI PETA NATIVE ====================

async function handleLokasi(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Masukkan nama lokasi atau kota.\nContoh: *.lokasi Monas Jakarta*");
    return;
  }

  try {
    const loc = await baileysNativeService.geocodeLocation(query);
    await context.socket.sendMessage(
      context.chatJid,
      {
        location: {
          degreesLatitude: loc.latitude,
          degreesLongitude: loc.longitude,
          name: loc.name,
          address: loc.address,
        },
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari koordinat lokasi."));
  }
}

// ==================== 5. KONTAK VCARD NATIVE ====================

async function handleKontakOwner(context: CommandContext): Promise<void> {
  try {
    const card = buildOwnerVCard();
    await context.socket.sendMessage(
      context.chatJid,
      {
        contacts: {
          displayName: card.displayName,
          contacts: [{ displayName: card.displayName, vcard: card.vcard }],
        },
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengirim kartu kontak Owner."));
  }
}

async function handleBuatKontak(context: CommandContext): Promise<void> {
  const raw = context.argsText.trim();
  const [namePart, phonePart] = raw.split("|").map((s) => s.trim());
  if (!namePart || !phonePart) {
    await context.reply("Format: *.buatkontak <nama> | <nomor>*\nContoh: *.buatkontak Admin Grup | 081234567890*");
    return;
  }

  try {
    const card = buildVCard(namePart, phonePart);
    await context.socket.sendMessage(
      context.chatJid,
      {
        contacts: {
          displayName: card.displayName,
          contacts: [{ displayName: card.displayName, vcard: card.vcard }],
        },
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat kartu kontak vCard."));
  }
}

// ==================== 6. KONTROL ADMIN GRUP NATIVE ====================

async function handleSetNamaGrup(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;
  const newSubject = context.argsText.trim();
  if (!newSubject || newSubject.length > 100) {
    await context.reply("Masukkan nama grup baru (1-100 karakter).\nContoh: *.setnamagrup Tongkrongan Sultan*");
    return;
  }

  try {
    await context.socket.groupUpdateSubject(context.chatJid, newSubject);
    await context.reply(`Nama grup berhasil diubah menjadi: *${newSubject}*`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengubah nama grup."));
  }
}

async function handleSetDeskripsiGrup(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;
  const rawDesc = context.argsText.trim();
  if (!rawDesc) {
    await context.reply(
      "Masukkan deskripsi grup baru (atau ketik *.setdeskripsigrup hapus* untuk mengosongkan).",
    );
    return;
  }
  if (rawDesc.length > 2048) {
    await context.reply("Deskripsi grup terlalu panjang (maksimal 2048 karakter).");
    return;
  }

  const clear = rawDesc.toLowerCase() === "hapus" || rawDesc.toLowerCase() === "clear";
  try {
    await context.socket.groupUpdateDescription(context.chatJid, clear ? "" : rawDesc);
    await context.reply(clear ? "Deskripsi grup berhasil dikosongkan." : "Deskripsi grup berhasil diperbarui.");
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memperbarui deskripsi grup."));
  }
}

async function handleSetPpGrup(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;
  const target = resolveImageMediaTarget(context);
  if (!target) {
    await context.reply("Kirim atau reply sebuah foto dengan perintah *.setppgrup* untuk mengganti ikon grup.");
    return;
  }
  if (target.fileLength && target.fileLength > MAX_GROUP_PHOTO_BYTES) {
    await context.reply("Ukuran foto terlalu besar (maksimal 5 MB).");
    return;
  }

  try {
    const rawBuffer = await downloadMediaMessage(target.message, "buffer", {});
    if (!Buffer.isBuffer(rawBuffer) || rawBuffer.byteLength === 0) {
      throw new AppUserError("Gagal mengunduh foto dari WhatsApp.");
    }
    const normalized = await baileysNativeService.normalizeGroupPhotoBuffer(rawBuffer);
    await context.socket.updateProfilePicture(context.chatJid, normalized);
    await context.reply("Foto profil (ikon) grup berhasil diperbarui.");
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengganti foto profil grup."));
  }
}

async function handleRevokeLink(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;

  try {
    await context.socket.groupRevokeInvite(context.chatJid);
    await context.reply(
      "Tautan undangan grup lama berhasil dicabut (reset)! Link undangan lama tidak lagi berlaku.",
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mereset link undangan grup."));
  }
}

async function handlePesanSementara(context: CommandContext): Promise<void> {
  if (!(await ensureGroupAdminAndBotAdmin(context))) return;

  try {
    const seconds = parseEphemeralDurationSeconds(context.args[0]);
    await context.socket.groupToggleEphemeral(context.chatJid, seconds);
    const label =
      seconds === 0
        ? "NONAKTIF (Off)"
        : seconds === 86400
          ? "24 Jam"
          : seconds === 604800
            ? "7 Hari"
            : "90 Hari";
    await context.reply(`Pengaturan Pesan Sementara (Disappearing Messages) diatur ke: *${label}*.`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengubah pengaturan pesan sementara grup."));
  }
}

export const baileysNativeCommands: CommandDefinition[] = [
  {
    name: "buatevent",
    aliases: ["eventgrup", "acara"],
    execute: handleBuatEvent,
  },
  {
    name: "pinpesan",
    aliases: ["pinmsg"],
    execute: handlePinPesan,
  },
  {
    name: "unpinpesan",
    aliases: ["unpinmsg"],
    execute: handleUnpinPesan,
  },
  {
    name: "react",
    aliases: ["reaksi"],
    execute: handleReact,
  },
  {
    name: "lokasi",
    aliases: ["maps", "peta", "loc"],
    execute: handleLokasi,
  },
  {
    name: "kontakowner",
    aliases: ["ownercontact", "vcardowner"],
    execute: handleKontakOwner,
  },
  {
    name: "buatkontak",
    aliases: ["vcard", "kontak"],
    execute: handleBuatKontak,
  },
  {
    name: "setnamagrup",
    aliases: ["setsubject", "gantinamagrup"],
    execute: handleSetNamaGrup,
  },
  {
    name: "setdeskripsigrup",
    aliases: ["setdesc", "gantideskripsi"],
    execute: handleSetDeskripsiGrup,
  },
  {
    name: "setppgrup",
    aliases: ["setgrouppp", "gantippgrup"],
    execute: handleSetPpGrup,
  },
  {
    name: "revokelink",
    aliases: ["resetlink", "gantilink"],
    execute: handleRevokeLink,
  },
  {
    name: "pesansementara",
    aliases: ["disappearing", "ephemeral"],
    execute: handlePesanSementara,
  },
];
