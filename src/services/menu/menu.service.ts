import os from "node:os";
import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import type { CommandContext } from "../../types/command";
import { formatDateId, formatNullableText } from "../../utils/format";

interface MenuSection {
  title: string;
  items: string[];
}

const SUB_MENU_NAV_LINES = [
  "*Sub-Menu Cepat:*",
  ".menu ai | .menu rpg | .menu game",
  ".menu sosial | .menu fun | .menu media",
  ".menu islami | .menu info | .menu grup",
] as const;

const MENU_LEGEND = "_Info: (L) = Pakai Limit | (Admin) = Admin_";

export class MenuService {
  constructor(private readonly tenantFeatureRepository = new TenantFeatureRepository()) {}

  buildHeader(context: CommandContext): string {
    const rawNumber = context.senderUserJid.split("@")[0] ?? context.senderUserJid;
    const now = new Date();

    const dayName = new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      timeZone: "Asia/Jakarta",
    }).format(now);

    const dateFormatted = new Intl.DateTimeFormat("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(now);

    const timeFormatted = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(now);

    const cpus = os.cpus();
    const cpuCores = cpus.length;
    const totalMemGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
    const freeMemGb = (os.freemem() / (1024 * 1024 * 1024)).toFixed(1);

    return [
      `Halo @~${rawNumber}`,
      `*── [ MINJIBOT V2 ] ──*`,
      `Hari   : ${dayName}, ${dateFormatted}`,
      `Waktu  : ${timeFormatted} WIB`,
      `Server : ${String(cpuCores)} Core | RAM ${freeMemGb}/${totalMemGb} GB`,
    ].join("\n");
  }

  async buildMenu(context: CommandContext): Promise<string> {
    const header = this.buildHeader(context);
    if (!context.isGroup) {
      return `${header}\n\n${this.buildPrivateMenu(context)}`;
    }

    const sub = (context.args[0] ?? "").trim().toLowerCase();
    if (
      sub &&
      [
        "ai",
        "rpg",
        "game",
        "sosial",
        "fun",
        "media",
        "tools",
        "grup",
        "group",
        "islami",
        "info",
      ].includes(sub)
    ) {
      const tenantGroup = context.tenantGroup;
      const featureSetting = tenantGroup
        ? await this.tenantFeatureRepository.findByGroupJid(tenantGroup.groupJid)
        : null;
      return `${header}\n\n${this.buildGroupSubMenu(sub, tenantGroup, featureSetting)}`;
    }

    const body = await this.buildGroupMenu(context);
    return `${header}\n\n${body}`;
  }

  private buildGroupSubMenu(
    category: string,
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    const groupHeader = `Grup: ${this.formatGroupName(tenantGroup)}`;
    const footer = [
      ...SUB_MENU_NAV_LINES,
      "_Ketik .menu untuk melihat seluruh daftar fitur._",
    ].join("\n");

    if (category === "ai") {
      return this.renderCategoryPage(
        "*── [ SUB-MENU: AI ] ──*",
        groupHeader,
        [this.buildAiSection()],
        footer,
      );
    }

    if (category === "rpg") {
      const sections: MenuSection[] = [];
      const rpg = this.buildRpgSection(featureSetting);
      const rpgInf = this.buildRpgInfiniteSection(featureSetting);
      if (rpg) sections.push(rpg);
      if (rpgInf) sections.push(rpgInf);
      sections.push(this.buildEconomySection());
      return this.renderCategoryPage("*── [ SUB-MENU: RPG ] ──*", groupHeader, sections, footer);
    }

    if (category === "game") {
      const gameSection = this.buildPureGameSection(featureSetting);
      const sections = gameSection
        ? [gameSection]
        : [{ title: "*── [ GAME NONAKTIF ] ──*", items: [] }];
      return this.renderCategoryPage("*── [ SUB-MENU: GAME ] ──*", groupHeader, sections, footer);
    }

    if (category === "sosial") {
      return this.renderCategoryPage(
        "*── [ SUB-MENU: SOSIAL ] ──*",
        groupHeader,
        [this.buildSocialDramaSection(), this.buildAnimeRpSection()],
        footer,
      );
    }

    if (category === "fun") {
      return this.renderCategoryPage(
        "*── [ SUB-MENU: FUN ] ──*",
        groupHeader,
        [this.buildFunSection()],
        footer,
      );
    }

    if (category === "media" || category === "tools") {
      return this.renderCategoryPage(
        "*── [ SUB-MENU: MEDIA ] ──*",
        groupHeader,
        [
          this.buildMediaCreativeSection(),
          this.buildPhotoMemeSection(),
          this.buildAudioToolsSection(),
          this.buildDownloaderSection(),
        ],
        footer,
      );
    }

    if (category === "islami") {
      return this.renderCategoryPage(
        "*── [ SUB-MENU: ISLAMI ] ──*",
        groupHeader,
        [this.buildIslamiSection()],
        footer,
      );
    }

    if (category === "info") {
      return this.renderCategoryPage(
        "*── [ SUB-MENU: INFO ] ──*",
        groupHeader,
        [this.buildPublicInfoSection()],
        footer,
      );
    }

    const sections: MenuSection[] = [this.buildInteractiveToolsSection()];
    const utility = this.buildUtilitySection(featureSetting);
    if (utility) sections.push(utility);
    return this.renderCategoryPage("*── [ SUB-MENU: GRUP ] ──*", groupHeader, sections, footer);
  }

  buildOwnerMenu(): string {
    return this.renderNumberedSections(
      ["*── [ MENU SUPER OWNER ] ──*", "Mode: Private Chat"],
      [
        {
          title: "*── [ MANAJEMEN TENANT ] ──*",
          items: [
            ".pendinggroup",
            ".activatetenant <kode> <owner>",
            ".listtenant",
            ".tenantinfo <kode>",
            ".extendtenant <kode> <durasi>",
            ".settenantexpire <kode> <tgl>",
            ".blocktenant <kode>",
            ".unblocktenant <kode>",
            ".removetenant <kode>",
            ".purgetenant <kode>",
            ".addlimitall <kode> <jumlah>",
          ],
        },
        {
          title: "*── [ NAVIGASI ] ──*",
          items: [".tenantmenu", ".featuremenu", ".menu"],
        },
      ],
    );
  }

  buildTenantOwnerMenu(): string {
    return this.renderNumberedSections(
      ["*── [ MENU TENANT ] ──*", "Mode: Private Chat"],
      [
        {
          title: "*── [ KONTROL SEWA ] ──*",
          items: [
            ".mytenant",
            ".usetenant <nomor/kode>",
            ".currenttenant",
            ".cleartenant",
            ".transferowner @user",
            ".addtenantadmin <nomor>",
            ".removetenantadmin <nomor>",
            ".listtenantadmin",
          ],
        },
        {
          title: "*── [ ATUR GRUP ] ──*",
          items: [
            ".feature <fitur> <on/off>",
            ".welcome [on|off]",
            ".setwelcome <pesan>",
            ".goodbye [on|off]",
            ".setgoodbye <pesan>",
            ".antilink [on|off]",
            ".antispam [on|off]",
          ],
        },
        {
          title: "*── [ AI & MEDIA ] ──*",
          items: [
            ".ai <pertanyaan> (L)",
            ".simi <pesan> (L)",
            ".tt <url> (L)",
            ".ig <url> (L)",
            ".yt <url> (L)",
            ".x <url> (L)",
            ".pin <kata/url> (L)",
            ".play <lagu> (L)",
            ".lirik [doc] <judul> (L)",
            ".hd [doc] (L)",
            ".s / .sticker",
            ".sa (stiker suara)",
            ".smeme <teks>",
            ".gambar <teks>",
            ".toimg",
          ],
        },
        {
          title: "*── [ INFORMASI ] ──*",
          items: [".profile", ".menu"],
        },
      ],
    );
  }

  buildFeatureMenu(): string {
    return [
      "*── [ KONTROL FITUR ] ──*",
      "Format: .feature <fitur> <on/off>",
      "",
      "1. downloader",
      "2. hd",
      "3. game",
      "4. welcome",
      "5. antilink",
      "6. antispam",
      "7. reminder",
      "8. tagall",
      "9. antidelete",
    ].join("\n");
  }

  private buildPrivateMenu(context: CommandContext): string {
    if (context.role === "SUPER_OWNER") {
      return this.buildOwnerMenu();
    }

    if (context.role === "TENANT_OWNER") {
      return this.buildTenantOwnerMenu();
    }

    return [
      "*── [ BANTUAN BOT ] ──*",
      "Fitur bot aktif di grup terdaftar.",
      "Hubungi Owner untuk sewa bot.",
      "",
      "1. .menu",
      "2. .ai <pertanyaan> (L)",
      "3. .simi <pesan> (L)",
      "4. .menfess <kode> <pesan>",
      "5. .ww <aksi> <nomor>",
    ].join("\n");
  }

  private async buildGroupMenu(context: CommandContext): Promise<string> {
    const tenantGroup = context.tenantGroup;
    const featureSetting = tenantGroup
      ? await this.tenantFeatureRepository.findByGroupJid(tenantGroup.groupJid)
      : null;

    if (context.role === "SUPER_OWNER") {
      return this.buildSuperOwnerGroupMenu(tenantGroup, featureSetting);
    }

    if (context.role === "TENANT_OWNER") {
      return this.buildTenantOwnerGroupMenu(tenantGroup, featureSetting);
    }

    if (context.role === "TENANT_ADMIN") {
      return this.buildTenantAdminGroupMenu(tenantGroup, featureSetting);
    }

    return this.buildPublicGroupMenu(tenantGroup, featureSetting);
  }

  private buildCommonGroupSections(featureSetting: TenantFeatureSetting | null): MenuSection[] {
    const sections: MenuSection[] = [this.buildAiSection(), this.buildEconomySection()];

    const rpg = this.buildRpgSection(featureSetting);
    if (rpg) sections.push(rpg);

    const rpgInf = this.buildRpgInfiniteSection(featureSetting);
    if (rpgInf) sections.push(rpgInf);

    const games = this.buildPureGameSection(featureSetting);
    if (games) sections.push(games);

    sections.push(
      this.buildSocialDramaSection(),
      this.buildFunSection(),
      this.buildAnimeRpSection(),
      this.buildMediaCreativeSection(),
      this.buildPhotoMemeSection(),
      this.buildAudioToolsSection(),
      this.buildDownloaderSection(),
      this.buildIslamiSection(),
      this.buildPublicInfoSection(),
      this.buildInteractiveToolsSection(),
    );

    const utility = this.buildUtilitySection(featureSetting);
    if (utility) sections.push(utility);

    return sections;
  }

  private buildSuperOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    const sections: MenuSection[] = [
      {
        title: "*── [ MANAJEMEN SEWA ] ──*",
        items: [
          ".activatetenant <kode> <owner>",
          ".listtenant",
          ".tenantinfo <kode>",
          ".extendtenant <kode> <durasi>",
          ".settenantexpire <kode> <tgl>",
          ".blocktenant <kode>",
          ".unblocktenant <kode>",
          ".removetenant <kode>",
          ".purgetenant <kode>",
          ".addlimitall <kode> <jumlah>",
          ".transferowner @user",
          ".addtenantadmin <nomor>",
          ".removetenantadmin <nomor>",
          ".listtenantadmin",
        ],
      },
      this.buildModerationSection(true),
      ...this.buildCommonGroupSections(featureSetting),
      {
        title: "*── [ PENGATURAN ] ──*",
        items: [
          ".feature <fitur> <on/off>",
          ".status",
          ".panel / .tenantstatus",
          ".ownermenu",
          ".tenantmenu",
          ".featuremenu",
          ".menu",
        ],
      },
    ];

    const total = countSectionItems(sections);
    return this.renderNumberedSections(
      [
        "*── [ DASHBOARD OWNER ] ──*",
        `Grup   : ${this.formatGroupName(tenantGroup)}`,
        `Kode   : ${tenantGroup ? tenantGroup.tenantCode : "-"}`,
        `Status : ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
        `Exp    : ${tenantGroup ? formatDateId(tenantGroup.expiresAt) : "-"}`,
        `Total  : ${String(total)} Fitur Tersedia`,
        MENU_LEGEND,
        "",
        ...SUB_MENU_NAV_LINES,
      ],
      sections,
      SUB_MENU_NAV_LINES,
    );
  }

  private buildTenantOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    const sections: MenuSection[] = [
      {
        title: "*── [ PENGATURAN SEWA ] ──*",
        items: [
          ".feature <fitur> <on/off>",
          ".welcome [on|off]",
          ".setwelcome <pesan>",
          ".goodbye [on|off]",
          ".setgoodbye <pesan>",
          ".transferowner @user",
          ".addtenantadmin <nomor>",
          ".removetenantadmin <nomor>",
          ".listtenantadmin",
        ],
      },
      this.buildModerationSection(true),
      ...this.buildCommonGroupSections(featureSetting),
      {
        title: "*── [ INFORMASI ] ──*",
        items: [".panel / .tenantstatus", ".status", ".featuremenu", ".menu"],
      },
    ];

    const total = countSectionItems(sections);
    return this.renderNumberedSections(
      [
        "*── [ DASHBOARD SEWA ] ──*",
        `Grup   : ${this.formatGroupName(tenantGroup)}`,
        `Kode   : ${tenantGroup ? tenantGroup.tenantCode : "-"}`,
        `Status : ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
        `Exp    : ${tenantGroup ? formatDateId(tenantGroup.expiresAt) : "-"}`,
        `Total  : ${String(total)} Fitur Tersedia`,
        MENU_LEGEND,
        "",
        ...SUB_MENU_NAV_LINES,
      ],
      sections,
      SUB_MENU_NAV_LINES,
    );
  }

  private buildTenantAdminGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    const sections: MenuSection[] = [
      {
        title: "*── [ ATUR GRUP ] ──*",
        items: [
          ".welcome [on|off] (Admin)",
          ".setwelcome <pesan> (Admin)",
          ".goodbye [on|off] (Admin)",
          ".setgoodbye <pesan> (Admin)",
          ".listtenantadmin (Admin)",
        ],
      },
      this.buildModerationSection(false),
      ...this.buildCommonGroupSections(featureSetting),
      {
        title: "*── [ INFORMASI ] ──*",
        items: [".panel / .tenantstatus", ".status", ".menu"],
      },
    ];

    const total = countSectionItems(sections);
    return this.renderNumberedSections(
      [
        "*── [ DASHBOARD ADMIN ] ──*",
        `Grup  : ${this.formatGroupName(tenantGroup)}`,
        `Total : ${String(total)} Fitur Tersedia`,
        MENU_LEGEND,
        "",
        ...SUB_MENU_NAV_LINES,
      ],
      sections,
      SUB_MENU_NAV_LINES,
    );
  }

  private buildPublicGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    const sections: MenuSection[] = [
      ...this.buildCommonGroupSections(featureSetting),
      {
        title: "*── [ BANTUAN ] ──*",
        items: [".status", ".menu"],
      },
    ];

    const total = countSectionItems(sections);
    return this.renderNumberedSections(
      [
        "*── [ MINJIBOT MENU ] ──*",
        `Grup  : ${this.formatGroupName(tenantGroup)}`,
        `Total : ${String(total)} Fitur Aktif`,
        MENU_LEGEND,
        "",
        ...SUB_MENU_NAV_LINES,
      ],
      sections,
      SUB_MENU_NAV_LINES,
    );
  }

  private buildAiSection(): MenuSection {
    return {
      title: "*── [ AI & CHAT ] ──*",
      items: [
        ".ai <pertanyaan> (L)",
        ".tanya <pertanyaan> (L)",
        ".gpt <pertanyaan> (L)",
        ".minji <pertanyaan> (L)",
        ".simi <obrolan> (L)",
      ],
    };
  }

  private buildEconomySection(): MenuSection {
    return {
      title: "*── [ DOMPET & BANK ] ──*",
      items: [
        ".profile [@user]",
        ".dompet [@user]",
        ".poin",
        ".limit",
        ".xp",
        ".daily",
        ".weekly",
        ".monthly",
        ".levelup",
        ".atm <jumlah|all>",
        ".atmall",
        ".pull <jumlah|all>",
        ".pullall",
        ".transfer @user <jumlah>",
        ".tukar <jumlah poin>",
        ".buy <jumlah>",
        ".buyall",
        ".giftpoint @user <jumlah>",
        ".giftlimit @user <jumlah>",
        ".toprich",
        ".leaderboard",
        ".toprank",
        ".toppoint",
        ".stats",
        ".topaktif",
        ".deletemydata",
      ],
    };
  }

  private buildRpgSection(featureSetting: TenantFeatureSetting | null): MenuSection | null {
    if (featureSetting && !featureSetting.gameEnabled) {
      return null;
    }

    return {
      title: "*── [ RPG & CHAOS ] ──*",
      items: [
        ".kerja",
        ".ojek",
        ".mulung",
        ".nambang",
        ".berburu",
        ".mancing",
        ".korupsi",
        ".megakorupsi",
        ".pajak [@user]",
        ".bansos",
        ".maling @user",
        ".casino <jumlah|all>",
        ".duel @user <jumlah>",
        ".terimaduel",
        ".tolakduel",
        ".crypto market",
        ".cooldown",
      ],
    };
  }

  private buildRpgInfiniteSection(featureSetting: TenantFeatureSetting | null): MenuSection | null {
    if (featureSetting && !featureSetting.gameEnabled) {
      return null;
    }

    return {
      title: "*── [ RPG INFINITE ] ──*",
      items: [
        ".inventory / .inv",
        ".kandang",
        ".heal [jumlah]",
        ".adventure",
        ".nebang",
        ".berkebon",
        ".masak <resep>",
        ".shop <list|buy|sell>",
        ".craft <alat>",
        ".upgrade <alat>",
        ".open <crate>",
        ".feed <pet>",
        ".ramuan <pet>",
        ".fightkucing",
        ".fightkyubi",
        ".fightcentaur",
        ".fightgriffin",
        ".fightnaga",
        ".fightphonix",
        ".berbisnis @user",
        ".dungeon [join|mulai]",
        ".serang @user",
      ],
    };
  }

  private buildPureGameSection(featureSetting: TenantFeatureSetting | null): MenuSection | null {
    if (featureSetting && !featureSetting.gameEnabled) {
      return null;
    }

    return {
      title: "*── [ GAME & KUIS ] ──*",
      items: [
        ".kuis",
        ".family100",
        ".mtk",
        ".tebakkata",
        ".tebakemoji",
        ".tebakangka",
        ".katla",
        ".caklontong",
        ".bom",
        ".slot [taruhan|allin]",
        ".tictactoe @user",
        ".werewolf / .ww",
        ".war [buat|join|mulai]",
        ".attack @user",
        ".clue",
        ".nyerah",
      ],
    };
  }

  private buildSocialDramaSection(): MenuSection {
    return {
      title: "*── [ SOSIAL & GENG ] ──*",
      items: [
        ".siapa <kalimat>",
        ".paling <sifat>",
        ".pick <1-10> <label>",
        ".jodohgrup",
        ".cekcocok @a @b",
        ".ship @a @b",
        ".fakta [@user]",
        ".ramalan [@user]",
        ".zodiak <bintang>",
        ".shio <tahun>",
        ".weton <dd-mm-yyyy>",
        ".beligelar <nama>",
        ".gelar",
        ".hapusgelar",
        ".nikah @user [mahar]",
        ".terimanikah",
        ".tolaknikah",
        ".bukunikah [@user]",
        ".cerai",
        ".geng <buat|join|top>",
        ".lelang <buka|info|tutup>",
        ".bid <nominal>",
      ],
    };
  }

  private buildAnimeRpSection(): MenuSection {
    return {
      title: "*── [ ANIME RP SFW ] ──*",
      items: [
        ".peluk [@user]",
        ".tampar [@user]",
        ".pat [@user]",
        ".bonk [@user]",
        ".poke [@user]",
        ".pukul [@user]",
        ".tendang [@user]",
        ".gigit [@user]",
        ".cuddle [@user]",
        ".highfive [@user]",
        ".wink [@user]",
        ".wave [@user]",
        ".baka [@user]",
        ".stare [@user]",
        ".yeet [@user]",
        ".blush",
        ".cry",
        ".smile",
        ".dance",
        ".smug",
        ".facepalm",
        ".shrug",
        ".thumbsup",
      ],
    };
  }

  private buildPhotoMemeSection(): MenuSection {
    return {
      title: "*── [ PHOTO MEME ] ──*",
      items: [
        ".wanted [@user]",
        ".jail [@user]",
        ".rip [@user]",
        ".triggered [@user]",
        ".trash [@user]",
        ".clown [@user]",
        ".blur",
        ".grayscale / .bw",
        ".invert",
        ".sepia",
        ".pixelate",
        ".mirror / .flip",
        ".rotate [90|180|270]",
        ".circle",
        ".polaroid [teks]",
      ],
    };
  }

  private buildFunSection(): MenuSection {
    return {
      title: "*── [ FUN & JADIAN ] ──*",
      items: [
        ".apakah <pertanyaan>",
        ".kapankah <pertanyaan>",
        ".rate <hal>",
        ".cekkhodam [@user]",
        ".cekhoki [@user]",
        ".ceksultan [@user]",
        ".cekbucin [@user]",
        ".cekganteng [@user]",
        ".cekcantik [@user]",
        ".cekwibu [@user]",
        ".cekpintar [@user]",
        ".cekgabut [@user]",
        ".cekjones [@user]",
        ".ceksadboy [@user]",
        ".cekstress [@user]",
        ".tembak @user",
        ".terima",
        ".tolak",
        ".cekpacar",
        ".putus",
        ".jodoh",
        ".truth",
        ".dare",
        ".alay <teks>",
        ".hilih <teks>",
        ".namaninja <nama>",
        ".readmore <a|b>",
        ".artinama <nama>",
        ".menfess <kode> <pesan>",
      ],
    };
  }

  private buildMediaCreativeSection(): MenuSection {
    return {
      title: "*── [ MEDIA & STIKER ] ──*",
      items: [
        ".s / .sticker",
        ".sa (stiker suara)",
        ".smeme <atas|bawah>",
        ".brat <teks>",
        ".ttp <teks>",
        ".emojimix <e1>+<e2>",
        ".tahta <teks>",
        ".carbon <kode>",
        ".wm <pack>|<author>",
        ".style <teks>",
        ".cekreso",
        ".resize <w> <h>",
        ".getfoto [detik]",
        ".quote [-s] [teks]",
        ".tweet [@user] <teks>",
        ".toimg",
        ".tovideo",
        ".ptv / .videonote",
        ".sw [teks/media] (Admin)",
        ".qr <teks>",
        ".calc <soal>",
        ".getpp [@user]",
        ".afk [alasan]",
      ],
    };
  }

  private buildAudioToolsSection(): MenuSection {
    return {
      title: "*── [ EFEK AUDIO ] ──*",
      items: [
        ".bass",
        ".chipmunk",
        ".slowed",
        ".nightcore",
        ".robot",
        ".reverse",
        ".fast",
        ".deep",
        ".earrape",
        ".smooth",
        ".tomp3",
        ".tovn",
      ],
    };
  }

  private buildDownloaderSection(): MenuSection {
    return {
      title: "*── [ DOWNLOADER ] ──*",
      items: [
        ".tt <url> (L)",
        ".ig <url> (L)",
        ".yt <url> (L)",
        ".x <url> (L)",
        ".pin <kata/url> (L)",
        ".facebook / .fb <url> (L)",
        ".threads <url> (L)",
        ".gitclone <url> (L)",
        ".play <judul> (L)",
        ".lirik [doc] <judul> (L)",
        ".hd [doc] (L)",
      ],
    };
  }

  private buildIslamiSection(): MenuSection {
    return {
      title: "*── [ ISLAMI ] ──*",
      items: [
        ".alquran <surah> [ayat]",
        ".jadwalshalat <kota>",
        ".asmaulhusna [1-99]",
        ".ayatkursi",
      ],
    };
  }

  private buildPublicInfoSection(): MenuSection {
    return {
      title: "*── [ INFO PUBLIK ] ──*",
      items: [
        ".infogempa",
        ".infocuaca <kota>",
        ".wikipedia <topik>",
        ".translate <bhs> <teks>",
        ".kbbi <kata>",
        ".jarak <kota1>|<kota2>",
        ".githubstalk <user>",
        ".npmsearch <paket>",
        ".whois <domain>",
        ".tinyurl <url>",
      ],
    };
  }

  private buildInteractiveToolsSection(): MenuSection {
    return {
      title: "*── [ INTERAKSI GRUP ] ──*",
      items: [
        ".mulaiabsen <judul>",
        ".absen",
        ".cekabsen",
        ".hapusabsen",
        ".poll tanya|opsi1|opsi2",
        ".mulaivote <topik>",
        ".upvote",
        ".devote",
        ".cekvote",
        ".hapusvote",
        ".buatcatatan <judul>|<isi>",
        ".lihatcatatan <judul>",
        ".listcatatan",
        ".hapuscatatan <judul>",
        ".infogrup",
        ".listadmin",
        ".tagme",
        ".link",
        ".setcmd <perintah> (Admin)",
        ".delcmd (Admin)",
        ".listcmd",
      ],
    };
  }

  private buildUtilitySection(featureSetting: TenantFeatureSetting | null): MenuSection | null {
    const reminderOn = !featureSetting || featureSetting.reminderEnabled;
    const tagAllOn = !featureSetting || featureSetting.tagAllEnabled;
    const items: string[] = [];

    if (reminderOn) {
      items.push(".remind <waktu> <pesan>", ".listreminder");
    }
    if (tagAllOn) {
      items.push(".tagall (Admin)", ".hidetag <pesan> (Admin)");
    }

    if (items.length === 0) {
      return null;
    }

    return {
      title: "*── [ PENGINGAT ] ──*",
      items,
    };
  }

  private buildModerationSection(includeAdvanced: boolean): MenuSection {
    const items: string[] = [
      ".antilink [on|off] (Admin)",
      ".antispam [on|off] (Admin)",
      ".antidelete [on|off] (Admin)",
      ".antiraid [on|off] (Admin)",
    ];

    if (includeAdvanced) {
      items.push(".antispam mode <mode>");
      items.push(".antiraid setting <n> <detik>");
    }

    items.push(
      ".grup [buka|tutup] (Admin)",
      ".warn @user [alasan] (Admin)",
      ".unwarn @user (Admin)",
      ".warns [@user]",
      ".resetwarn @user (Admin)",
      ".setwarn <jumlah> (Admin)",
      ".silent [hari] (Admin)",
      ".kick @user (Admin)",
      ".add <nomor> (Admin)",
      ".promote @user (Admin)",
      ".demote @user (Admin)",
      ".del (Admin)",
    );

    return {
      title: "*── [ MODERASI GRUP ] ──*",
      items,
    };
  }

  private renderCategoryPage(
    title: string,
    groupHeader: string,
    sections: MenuSection[],
    footer: string,
  ): string {
    const total = countSectionItems(sections);
    return this.renderNumberedSections(
      [title, groupHeader, `Total: ${String(total)} Fitur`, MENU_LEGEND],
      sections,
      [footer],
    );
  }

  private renderNumberedSections(
    headerLines: readonly string[],
    sections: readonly MenuSection[],
    footerLines: readonly string[] = [],
  ): string {
    const out: string[] = [...headerLines];
    let counter = 1;

    for (const section of sections) {
      out.push("", section.title);
      if (section.items.length === 0) {
        out.push("_Fitur kategori ini sedang nonaktif di grup ini._");
        continue;
      }
      for (const item of section.items) {
        out.push(`${String(counter)}. ${item}`);
        counter += 1;
      }
    }

    if (footerLines.length > 0) {
      out.push("", ...footerLines);
    }

    return out.join("\n");
  }

  private formatGroupName(tenantGroup: TenantGroup | undefined): string {
    if (!tenantGroup) return "Grup Umum";
    return formatNullableText(tenantGroup.name);
  }
}

function countSectionItems(sections: readonly MenuSection[]): number {
  let total = 0;
  for (const s of sections) {
    total += s.items.length;
  }
  return total;
}

export const menuService = new MenuService();
