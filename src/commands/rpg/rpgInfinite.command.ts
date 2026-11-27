import { identityResolverService } from "../../services/identity/identityResolver.service";
import {
  normalizeCrateType,
  normalizePetType,
  normalizeToolType,
  SHOP_ITEM_MAP,
  TOOL_SPECS,
} from "../../services/rpg/rpgCatalog";
import {
  BUSINESS_CAPITAL_PER_PERSON,
  rpgGroupInteractionService,
} from "../../services/rpg/rpgGroupInteraction.service";
import { rpgInfiniteService } from "../../services/rpg/rpgInfinite.service";
import type { PetType } from "../../services/rpg/rpgState";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { absBigInt, formatRemainingDuration, formatRupiah } from "../../utils/currency";
import { getBotCanonicalJids, normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

async function ensureActiveGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah RPG ini hanya bisa digunakan di grup aktif.");
    return false;
  }
  return true;
}

async function resolveSender(context: CommandContext): Promise<string> {
  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

function formatItemList(items: Record<string, number>): string {
  const entries = Object.entries(items).filter(([, qty]) => qty > 0);
  if (entries.length === 0) return "-";
  return entries
    .map(([id, qty]) => {
      const label = SHOP_ITEM_MAP.get(id)?.label ?? id;
      return `${label} x${String(qty)}`;
    })
    .join(", ");
}

async function handleInventory(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const inv = await rpgInfiniteService.getInventory(context.chatJid, sender);
    const ugdLine =
      inv.ugdRemainingMs > 0
        ? `• Status UGD : Dirawat (${formatRemainingDuration(inv.ugdRemainingMs)} lagi)`
        : "• Status     : Sehat";

    const toolLines = inv.tools.map((t) =>
      t.level > 0
        ? `• ${t.label} : Lv.${String(t.level)} (Dur ${String(t.durability)}%)`
        : `• ${t.label} : Belum punya (.craft ${t.id})`,
    );

    const crateLines = inv.crates
      .filter((c) => c.count > 0)
      .map((c) => `• ${c.id} : ${String(c.count)} peti`);

    const itemLines = inv.items.map(
      (item) => `• ${item.label} (${item.id}) : x${String(item.count)}`,
    );

    await context.reply(
      [
        "*── [ TAS & STATUS RPG ] ──*",
        `Pemilik : ${tagOf(sender)}`,
        `• HP     : ${String(inv.hp)} / ${String(inv.maxHp)}`,
        `• Level  : Lv. ${String(inv.level)}`,
        `• Dompet : ${formatRupiah(inv.moneyBalance)}`,
        ugdLine,
        "",
        "*Peralatan:*",
        ...toolLines,
        "",
        "*Peti Gacha (.open):*",
        ...(crateLines.length > 0 ? crateLines : ["Belum ada peti."]),
        "",
        "*Isi Tas:*",
        ...(itemLines.length > 0 ? itemLines : ["Tas masih kosong. Coba .adventure atau .nebang!"]),
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka tas RPG."));
  }
}

async function handleKandang(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const pen = await rpgInfiniteService.getPetPen(context.chatJid, sender);
    const petLines = pen.pets.map((p) =>
      p.level > 0
        ? `• *${p.label}* : Lv.${String(p.level)} | Power ${String(p.power)} | Kenyang ${String(p.hunger)}%`
        : `• ${p.label} : Belum punya`,
    );

    await context.reply(
      [
        "*── [ KANDANG PET ] ──*",
        `Pemilik : ${tagOf(sender)}`,
        "",
        ...petLines,
        "",
        `• Stok Pakan  : ${String(pen.foodCount)} (.feed <pet>)`,
        `• Stok Ramuan : ${String(pen.elixirCount)} (.ramuan <pet>)`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melihat kandang pet."));
  }
}

async function handleHeal(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawCount = context.args[0];
  const count = rawCount ? Number.parseInt(rawCount, 10) : undefined;
  if (rawCount && (count === undefined || !Number.isInteger(count) || count <= 0)) {
    await context.reply("Format salah.\nGunakan: .heal [jumlah potion]\nContoh: .heal atau .heal 2");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.healPlayer(context.chatJid, sender, count);
    await context.reply(
      [
        "*── [ PULIHKAN HP ] ──*",
        `• Potion dipakai : ${String(res.potionsUsed)}`,
        `• HP Sekarang    : ${String(res.hpBefore)} -> *${String(res.hpAfter)}/100*`,
        `• Sisa Potion    : ${String(res.potionsLeft)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memulihkan HP."));
  }
}

async function handleAdventure(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.runAdventure(context.chatJid, sender);
    await context.reply(
      [
        "*── [ PETUALANGAN RPG ] ──*",
        `${tagOf(sender)} menjelajahi *${res.zone}*!`,
        "",
        `• Uang     : +${formatRupiah(res.moneyGained)}`,
        `• XP       : +${String(res.xpGained)} XP`,
        `• Item     : ${formatItemList(res.itemsFound)}`,
        `• Peti     : ${res.crateFound ? `1x ${res.crateFound} crate` : "-"}`,
        `• HP       : -${String(res.hpLost)} (Sisa ${String(res.hpAfter)}/100)`,
        `• Dompetmu : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjalankan petualangan."));
  }
}

async function handleGather(context: CommandContext, action: "nebang" | "berkebon"): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.runGathering(context.chatJid, sender, action);
    const title = action === "nebang" ? "NEBANG KAYU" : "BERKEBON BUAH";
    const bonusText =
      res.toolBonusPercent > 0 ? ` (Bonus Alat +${String(res.toolBonusPercent)}%)` : "";

    await context.reply(
      [
        `*── [ ${title} ] ──*`,
        `Pelaku : ${tagOf(sender)}`,
        "",
        `• Uang     : +${formatRupiah(res.moneyGained)}${bonusText}`,
        `• XP       : +${String(res.xpGained)} XP`,
        `• Hasil    : ${formatItemList(res.itemsGained)}`,
        `• Dompetmu : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, `Gagal menjalankan .${action}.`));
  }
}

async function handleCook(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const recipeArg = context.args[0]?.trim().toLowerCase();
  if (!recipeArg || recipeArg === "list") {
    const recipes = rpgInfiniteService.listCookRecipes();
    const lines = [
      "*── [ DAFTAR RESEP MASAK ] ──*",
      ...recipes.map((r) => {
        const ings = Object.entries(r.ingredients)
          .map(([k, v]) => `${String(v)} ${k}`)
          .join(" + ");
        return `• *${r.id}* (${r.label})\n  Bahan: ${ings} | Jual: ${formatRupiah(r.sellPrice)}`;
      }),
      "",
      "Cara pakai: .masak <resep> [jumlah]\nContoh: .masak steak 2",
    ];
    await context.reply(lines.join("\n"));
    return;
  }

  const qtyArg = context.args[1];
  const qty = qtyArg ? Number.parseInt(qtyArg, 10) : 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    await context.reply("Jumlah masakan harus bilangan bulat positif.");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.cookFood(context.chatJid, sender, recipeArg, qty);
    await context.reply(
      [
        "*── [ MEMASAK BERHASIL ] ──*",
        `• Masakan    : ${String(res.quantity)}x *${res.recipeLabel}*`,
        `• XP Didapat : +${String(res.xpGained)} XP`,
        `• Total Stok : ${String(res.totalOwned)} (${formatRupiah(res.sellValueEach)}/porsi)`,
        "",
        `_Jual di toko: .shop sell ${res.recipeId} all_`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memasak."));
  }
}

async function handleShop(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const sub = (context.args[0] ?? "list").trim().toLowerCase();

  if (sub === "list" || sub === "daftar" || sub === "menu") {
    const catalog = rpgInfiniteService.listShopItems();
    const buyables = catalog.filter((i) => i.buyPrice !== null);
    const sellOnly = catalog.filter((i) => i.buyPrice === null);

    await context.reply(
      [
        "*── [ TOKO RPG SULTAN ] ──*",
        "",
        "*Barang Dijual (Beli / Jual):*",
        ...buyables.map(
          (i) =>
            `• *${i.id}* : Beli ${formatRupiah(i.buyPrice ?? 0n)} | Jual ${formatRupiah(i.sellPrice)}`,
        ),
        "",
        "*Hasil Panen & Masak (Jual):*",
        ...sellOnly.map((i) => `• *${i.id}* : Jual ${formatRupiah(i.sellPrice)}`),
        "",
        "Cara pakai:",
        "• .shop buy <item> [jumlah]",
        "• .shop sell <item> [jumlah|all]",
      ].join("\n"),
    );
    return;
  }

  const itemArg = context.args[1];
  const qtyArg = context.args[2];

  try {
    const sender = await resolveSender(context);

    if (sub === "buy" || sub === "beli") {
      if (!itemArg) {
        await context.reply("Format: .shop buy <item> [jumlah]\nContoh: .shop buy potion 3");
        return;
      }
      const qty = qtyArg ? Number.parseInt(qtyArg, 10) : 1;
      if (!Number.isInteger(qty) || qty <= 0) {
        await context.reply("Jumlah beli harus angka bulat positif.");
        return;
      }
      const res = await rpgInfiniteService.shopBuy(context.chatJid, sender, itemArg, qty);
      await context.reply(
        [
          "*── [ PEMBELIAN BERHASIL ] ──*",
          `• Item       : ${String(res.quantity)}x ${res.itemLabel}`,
          `• Total Bayar: ${formatRupiah(res.totalMoney)}`,
          `• Stok Kamu  : ${String(res.remainingQty)}`,
          `• Sisa Dompet: ${formatRupiah(res.currentMoney)}`,
        ].join("\n"),
      );
      return;
    }

    if (sub === "sell" || sub === "jual") {
      if (!itemArg) {
        await context.reply("Format: .shop sell <item> [jumlah|all]\nContoh: .shop sell steak all");
        return;
      }
      const qtyOrAll =
        !qtyArg || qtyArg.toLowerCase() === "1"
          ? 1
          : qtyArg.toLowerCase() === "all" || qtyArg.toLowerCase() === "semua"
            ? "all"
            : Number.parseInt(qtyArg, 10);
      if (qtyOrAll !== "all" && (!Number.isInteger(qtyOrAll) || qtyOrAll <= 0)) {
        await context.reply("Jumlah jual harus angka bulat positif atau 'all'.");
        return;
      }
      const res = await rpgInfiniteService.shopSell(context.chatJid, sender, itemArg, qtyOrAll);
      await context.reply(
        [
          "*── [ PENJUALAN BERHASIL ] ──*",
          `• Item       : ${String(res.quantity)}x ${res.itemLabel}`,
          `• Hasil Jual : +${formatRupiah(res.totalMoney)}`,
          `• Sisa Stok  : ${String(res.remainingQty)}`,
          `• Dompetmu   : ${formatRupiah(res.currentMoney)}`,
        ].join("\n"),
      );
      return;
    }

    await context.reply(
      "Format toko:\n• .shop list\n• .shop buy <item> [jumlah]\n• .shop sell <item> [jumlah|all]",
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses transaksi toko."));
  }
}

async function handleForge(context: CommandContext, mode: "craft" | "upgrade"): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const tool = normalizeToolType(context.args[0]);
  if (!tool) {
    const lines = [
      mode === "craft" ? "*── [ DAFTAR CRAFT ALAT ] ──*" : "*── [ UPGRADE ALAT RPG ] ──*",
      ...Object.values(TOOL_SPECS).map((s) => {
        const mats = Object.entries(mode === "craft" ? s.craftMaterials : s.upgradeMaterials)
          .map(([k, v]) => `${String(v)} ${k}`)
          .join(", ");
        const price = mode === "craft" ? s.craftCostMoney : s.upgradeMoneyPerLevel;
        return `• *${s.id}* (${s.label}): ${s.bonusDesc}\n  Bahan: ${mats} | Biaya: ${formatRupiah(price)}${mode === "upgrade" ? " x Lv" : ""}`;
      }),
      "",
      `Contoh: .${mode} sword`,
    ];
    await context.reply(lines.join("\n"));
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res =
      mode === "craft"
        ? await rpgInfiniteService.craftTool(context.chatJid, sender, tool)
        : await rpgInfiniteService.upgradeTool(context.chatJid, sender, tool);

    await context.reply(
      [
        mode === "craft" ? "*── [ CRAFT BERHASIL ] ──*" : "*── [ UPGRADE BERHASIL ] ──*",
        `• Alat       : *${res.toolLabel}* -> Lv.${String(res.newLevel)}`,
        `• Durability : ${String(res.durability)}%`,
        `• Biaya      : ${formatRupiah(res.moneySpent)}`,
        `• Sisa Dompet: ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, `Gagal memproses .${mode}.`));
  }
}

async function handleOpenCrate(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const crate = normalizeCrateType(context.args[0]);
  if (!crate) {
    await context.reply(
      "Format salah.\nGunakan: .open <common|uncommon|mythic|legendary> [jumlah]\nContoh: .open common 2",
    );
    return;
  }

  const qtyArg = context.args[1];
  const qty = qtyArg ? Number.parseInt(qtyArg, 10) : 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    await context.reply("Jumlah peti harus bilangan bulat positif.");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.openCrate(context.chatJid, sender, crate, qty);
    const petLines = res.petsGained.map((p) =>
      p.unlocked
        ? `• PET BARU! *${p.pet.toUpperCase()}* (Lv.${String(p.newLevel)}) masuk kandang!`
        : `• PET LEVEL UP! *${p.pet.toUpperCase()}* naik ke Lv.${String(p.newLevel)}!`,
    );

    await context.reply(
      [
        "*── [ GACHA PETI BERHASIL ] ──*",
        `Dibuka : ${String(res.openedCount)}x *${res.crateLabel}*`,
        "",
        `• Uang     : +${formatRupiah(res.moneyGained)}`,
        `• XP       : +${String(res.xpGained)} XP`,
        `• Item     : ${formatItemList(res.itemsGained)}`,
        ...petLines,
        `• Dompetmu : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka peti gacha."));
  }
}

async function handlePetCare(context: CommandContext, mode: "feed" | "ramuan"): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const pet = normalizePetType(context.args[0]);
  if (!pet) {
    await context.reply(
      `Format salah.\nGunakan: .${mode} <kucing|kyubi|centaur|griffin|naga|phonix>\nContoh: .${mode} naga`,
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.careForPet(context.chatJid, sender, pet, mode);
    const levelNote =
      res.newLevel > res.oldLevel
        ? `Lv.${String(res.oldLevel)} -> *Lv.${String(res.newLevel)}* (NAIK LEVEL!)`
        : `Lv.${String(res.newLevel)} (EXP ${String(res.exp)})`;

    await context.reply(
      [
        mode === "feed" ? "*── [ BERI MAKAN PET ] ──*" : "*── [ RAMUAN KUAT PET ] ──*",
        `• Pet       : *${res.petLabel}*`,
        `• Status    : ${levelNote}`,
        `• Kenyang   : ${String(res.hunger)}%`,
        `• Sisa Stok : ${String(res.remainingSupply)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal merawat pet."));
  }
}

async function handleBossFight(context: CommandContext, bossId: PetType): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgInfiniteService.fightBoss(context.chatJid, sender, bossId);

    if (!res.won) {
      await context.reply(
        [
          "*── [ KALAH LAWAN BOSS ] ──*",
          `${tagOf(sender)} kalah melawan *${res.bossName}*!`,
          `• Power Kamu : ${String(res.playerPower)} vs Boss ${String(res.bossPower)}`,
          `• HP Berkurang: -${String(res.hpLost)} (Sisa ${String(res.hpAfter)}/100)`,
          `• XP Hiburan : +${String(res.xpGained)} XP`,
          "",
          "_Tips: .craft/.upgrade sword & armor lalu .heal sebelum menantang ulang!_",
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    await context.reply(
      [
        "*── [ BOSS DIKALAHKAN! ] ──*",
        `${tagOf(sender)} menumbangkan *${res.bossName}*!`,
        `• Power Kamu : ${String(res.playerPower)} vs Boss ${String(res.bossPower)}`,
        "",
        `• Hadiah Uang : +${formatRupiah(res.moneyGained)}`,
        `• XP Didapat  : +${String(res.xpGained)} XP`,
        `• Bonus Peti  : 1x ${res.crateGained ?? "-"} crate`,
        ...(res.petDropped
          ? [`• RARE DROP! Pet *${bossId.toUpperCase()}* kini Lv.${String(res.petNewLevel)}!`]
          : []),
        `• Sisa HP     : ${String(res.hpAfter)}/100`,
        `• Dompetmu    : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melawan boss."));
  }
}

async function handleBusiness(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const rawTargets: string[] = [...context.mentionedJids];
  if (rawTargets.length === 0 && context.quoted?.participantJid) {
    rawTargets.push(context.quoted.participantJid);
  }
  if (rawTargets.length === 0) {
    await context.reply(
      [
        "*── [ PATUNGAN BISNIS GRUP ] ──*",
        `Modal per orang: ${formatRupiah(BUSINESS_CAPITAL_PER_PERSON)}`,
        "Tag 1 sampai 3 teman grup untuk patungan bisnis!",
        "Contoh: .berbisnis @teman1 @teman2",
      ].join("\n"),
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const botJids = getBotCanonicalJids(context.socket);
    const resolvedPartners: string[] = [];

    for (const raw of rawTargets) {
      const canonical = await identityResolverService.resolveCanonicalUserJid(
        context.socket,
        context.chatJid,
        normalizeUserJid(raw),
      );
      if (botJids.has(canonical)) {
        await context.reply("Bot tidak bisa diajak patungan bisnis, tag member grup lain ya!");
        return;
      }
      resolvedPartners.push(canonical);
    }

    const res = await rpgGroupInteractionService.runGroupBusiness(
      context.chatJid,
      sender,
      resolvedPartners,
    );
    const teamTags = res.participants.map(tagOf).join(", ");

    await context.reply(
      [
        res.profitable ? "*── [ BISNIS UNTUNG BESAR ] ──*" : "*── [ BISNIS KENA KOREKSI ] ──*",
        `Usaha  : *${res.ventureName}*`,
        `Mitra  : ${teamTags}`,
        "",
        res.profitable
          ? `• Profit per Orang : +${formatRupiah(res.netDeltaPerPerson)}`
          : `• Rugi per Orang   : -${formatRupiah(absBigInt(res.netDeltaPerPerson))}`,
        `• XP per Orang     : +${String(res.xpGained)} XP`,
      ].join("\n"),
      { mentions: res.participants },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses patungan bisnis."));
  }
}

async function handleDungeon(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const sub = (context.args[0] ?? "").trim().toLowerCase();

  try {
    const sender = await resolveSender(context);

    if (sub === "join" || sub === "gabung") {
      const lobby = await rpgGroupInteractionService.joinDungeonLobby(context.chatJid, sender);
      const list = lobby.players.map((p, idx) => `${String(idx + 1)}. ${tagOf(p)}`).join("\n");
      await context.reply(
        [
          "*── [ LOBBY DUNGEON CO-OP ] ──*",
          `${tagOf(sender)} bergabung ke tim raid!`,
          "",
          `Anggota (${String(lobby.players.length)}/4):`,
          list,
          "",
          "Host ketik *.dungeon mulai* jika sudah siap!",
        ].join("\n"),
        { mentions: lobby.players },
      );
      return;
    }

    if (sub === "batal" || sub === "keluar" || sub === "cancel") {
      rpgGroupInteractionService.cancelDungeonLobby(context.chatJid, sender);
      await context.reply("Lobby dungeon telah diperbarui/dibatalkan.");
      return;
    }

    if (sub === "mulai" || sub === "start") {
      const res = await rpgGroupInteractionService.startDungeonRaid(context.chatJid, sender);
      const mentions = res.members.map((m) => m.userJid);
      const memberLines = res.members.map((m) =>
        res.won
          ? `• ${tagOf(m.userJid)}: +${formatRupiah(m.moneyGained)} | +${String(m.xpGained)} XP | ${m.crateGained ? `1x ${m.crateGained}` : "-"} | HP ${String(m.hpAfter)}/100`
          : `• ${tagOf(m.userJid)}: +${String(m.xpGained)} XP | HP -${String(m.hpLost)} (${String(m.hpAfter)}/100)`,
      );

      await context.reply(
        [
          res.won ? "*── [ DUNGEON CLEARED! ] ──*" : "*── [ RAID DUNGEON GAGAL ] ──*",
          `Boss  : *${res.bossName}*`,
          `Power : Tim ${String(res.teamPower)} vs Boss ${String(res.bossPower)}`,
          "",
          ...memberLines,
        ].join("\n"),
        { mentions },
      );
      return;
    }

    const { created, lobby } = await rpgGroupInteractionService.createOrInspectDungeonLobby(
      context.chatJid,
      sender,
    );
    const list = lobby.players.map((p, idx) => `${String(idx + 1)}. ${tagOf(p)}`).join("\n");
    await context.reply(
      [
        created ? "*── [ LOBBY DUNGEON DIBUAT ] ──*" : "*── [ LOBBY DUNGEON AKTIF ] ──*",
        `Host : ${tagOf(lobby.hostJid)}`,
        "",
        `Anggota (${String(lobby.players.length)}/4):`,
        list,
        "",
        "Perintah:",
        "• .dungeon join  (gabung ke tim)",
        "• .dungeon mulai (mulai raid sekarang)",
        "• .dungeon batal (batal/keluar lobby)",
      ].join("\n"),
      { mentions: lobby.players },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses dungeon."));
  }
}

async function handleAttack(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  let rawTarget: string | null = null;
  if (context.mentionedJids[0]) {
    rawTarget = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTarget = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args[0]) {
    const rawNum = context.args[0].replace(/^@/, "").trim();
    if (/^\d{8,15}$/.test(rawNum)) {
      rawTarget = normalizeUserJid(`${rawNum}@s.whatsapp.net`);
    }
  }

  if (!rawTarget) {
    await context.reply("Tag atau reply target yang mau diserang!\nContoh: .serang @user");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const target = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      rawTarget,
    );
    const botJids = getBotCanonicalJids(context.socket);
    if (botJids.has(target)) {
      await context.reply("Bot memakai armor kebal abadi, cari target member lain ya!");
      return;
    }

    const res = await rpgGroupInteractionService.attackPlayer(context.chatJid, sender, target);
    if (!res.success) {
      await context.reply(
        [
          "*── [ SERANGAN DITANGKIS! ] ──*",
          `${tagOf(sender)} menyerang ${tagOf(target)}, tapi armor lawan terlalu tebal!`,
          `• Power : ${String(res.attackerPower)} vs Defense ${String(res.defenderPower)}`,
          `• HP Kamu kena serangan balik -> ${String(res.attackerHpAfter)}/100`,
        ].join("\n"),
        { mentions: [sender, target] },
      );
      return;
    }

    await context.reply(
      [
        "*── [ SERANGAN BERHASIL! ] ──*",
        `${tagOf(sender)} menghajar ${tagOf(target)} dan merampas dompetnya!`,
        `• Power      : ${String(res.attackerPower)} vs Defense ${String(res.defenderPower)}`,
        `• Damage     : -${String(res.damageDealt)} HP`,
        `• Rampasan   : +${formatRupiah(res.moneyLooted)}`,
        `• Dompetmu   : ${formatRupiah(res.attackerMoney)}`,
        ...(res.sentToUgd
          ? [
              "",
              `Korban tumbang & masuk *UGD ${String(res.ugdMinutes)} menit* (kebal serangan anti-bully sampai pulih).`,
            ]
          : [`• Sisa HP Korban : ${String(res.targetHpAfter)}/100`]),
      ].join("\n"),
      { mentions: [sender, target] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menyerang target."));
  }
}

export const rpgInfiniteCommands: CommandDefinition[] = [
  { name: "inventory", aliases: ["inv", "tas"], execute: handleInventory },
  { name: "kandang", aliases: ["pet", "pets"], execute: handleKandang },
  { name: "heal", execute: handleHeal },
  { name: "adventure", aliases: ["petualangan", "adv"], execute: handleAdventure },
  { name: "nebang", execute: (ctx) => handleGather(ctx, "nebang") },
  { name: "berkebon", aliases: ["berkebun"], execute: (ctx) => handleGather(ctx, "berkebon") },
  { name: "masak", aliases: ["cook"], execute: handleCook },
  { name: "shop", aliases: ["toko"], execute: handleShop },
  { name: "craft", execute: (ctx) => handleForge(ctx, "craft") },
  { name: "upgrade", execute: (ctx) => handleForge(ctx, "upgrade") },
  { name: "open", aliases: ["gacha", "bukapeti"], execute: handleOpenCrate },
  { name: "feed", execute: (ctx) => handlePetCare(ctx, "feed") },
  { name: "ramuan", execute: (ctx) => handlePetCare(ctx, "ramuan") },
  { name: "fightkucing", execute: (ctx) => handleBossFight(ctx, "kucing") },
  { name: "fightkyubi", execute: (ctx) => handleBossFight(ctx, "kyubi") },
  { name: "fightcentaur", execute: (ctx) => handleBossFight(ctx, "centaur") },
  { name: "fightgriffin", execute: (ctx) => handleBossFight(ctx, "griffin") },
  { name: "fightnaga", execute: (ctx) => handleBossFight(ctx, "naga") },
  { name: "fightphonix", aliases: ["fightphoenix"], execute: (ctx) => handleBossFight(ctx, "phonix") },
  { name: "berbisnis", aliases: ["bisnis"], execute: handleBusiness },
  { name: "dungeon", execute: handleDungeon },
  { name: "serang", aliases: ["membunuh"], execute: handleAttack },
];
