import { menuService, type MenuService, type SearchableMenuEntry } from "./menu.service";

export interface RouterCommandSummary {
  name: string;
  aliases: string[];
}

export interface FeatureSearchMatch {
  usage: string;
  category: string;
  primaryCommand: string;
  matchedAliases: string[];
  score: number;
}

export interface FeatureSearchResponse {
  query: string;
  matches: FeatureSearchMatch[];
  totalCatalogItems: number;
  totalRegisteredCommands: number;
  totalCommandsWithAliases: number;
}

const KEYWORD_SYNONYMS: Record<string, readonly string[]> = {
  download: ["tt", "ig", "yt", "x", "pin", "facebook", "fb", "threads", "gitclone", "play", "lirik"],
  unduh: ["tt", "ig", "yt", "x", "pin", "facebook", "threads", "gitclone", "play"],
  video: ["tt", "ig", "yt", "x", "facebook", "threads", "tovideo", "ptv", "getfoto"],
  lagu: ["play", "lirik", "tebaklagu", "tebaklirik", "bass", "slowed", "nightcore", "tovn"],
  musik: ["play", "lirik", "tebaklagu", "bass", "slowed", "nightcore", "tomp3", "tovn"],
  audio: ["play", "bass", "chipmunk", "slowed", "nightcore", "robot", "reverse", "tomp3", "tovn"],
  stiker: ["s", "sa", "smeme", "brat", "ttp", "emojimix", "wm", "circle", "toimg", "tovideo", "setcmd"],
  sticker: ["s", "sa", "smeme", "brat", "ttp", "emojimix", "wm", "circle", "toimg", "tovideo", "setcmd"],
  foto: ["hd", "ocr", "jelaskanfoto", "wanted", "jail", "rip", "triggered", "trash", "clown", "blur", "grayscale", "polaroid", "resize", "getfoto", "getpp", "cekreso"],
  gambar: ["hd", "ocr", "jelaskanfoto", "wanted", "jail", "polaroid", "toimg", "emojimix", "tahta", "carbon", "color"],
  uang: ["dompet", "atm", "pull", "transfer", "kerja", "gaji", "panen", "properti", "deposito", "saham", "crypto", "portofolio", "korupsi", "maling", "pajak", "bansos", "toprich"],
  duit: ["dompet", "atm", "pull", "transfer", "kerja", "gaji", "panen", "properti", "deposito", "saham", "toprich"],
  bank: ["atm", "atmall", "pull", "pullall", "deposito", "cairdeposito", "dompet", "transfer"],
  limit: ["limit", "buy", "buyall", "daily", "misi", "klaimmisi", "gaji", "giftlimit", "redeem", "spin"],
  ai: ["ai", "tanya", "gpt", "minji", "simi", "ringkas", "tanyachat", "ocr", "jelaskanfoto", "roast", "puji", "pantunai", "cerpen", "curhat", "debat", "koding", "perbaiki", "summarize", "ide"],
  islam: ["alquran", "jadwalshalat", "asmaulhusna", "ayatkursi", "doaharian", "niatshalat", "dzikir", "hadits", "kisahnabi", "kalenderhijriah"],
  shalat: ["jadwalshalat", "niatshalat", "dzikir", "doaharian"],
  quran: ["alquran", "ayatkursi"],
  anime: ["anime", "manga", "karakter", "peluk", "tampar", "pat", "bonk", "cuddle", "dance"],
  wibu: ["anime", "manga", "karakter", "cekwibu", "peluk", "bonk"],
  game: ["kuis", "family100", "mtk", "katla", "caklontong", "bom", "slot", "tictactoe", "werewolf", "undercover", "sambungkata", "war", "blackjack", "hilow", "suit", "roulette", "russian", "spin"],
  kasino: ["casino", "blackjack", "hilow", "suit", "dadu", "koin", "roulette", "tebakdadu", "russian", "spin", "slot"],
  tebak: ["tebakkata", "tebakemoji", "tebakangka", "susunkata", "tebakbendera", "siapakahaku", "tebakkalimat", "tebaklirik", "tekateki", "asahotak", "tebakkimia", "tebakibukota", "tebakprovinsi", "tebaklagu", "benarsalah", "tebakreceh"],
  nikah: ["nikah", "terimanikah", "tolaknikah", "bukunikah", "cerai", "tembak", "jodoh", "ship", "cekcocok"],
  pacar: ["tembak", "terima", "tolak", "cekpacar", "putus", "jodoh", "ship", "bucin"],
  geng: ["geng", "war", "attack"],
  clan: ["geng"],
  saham: ["saham", "belisaham", "jualsaham", "portofolio"],
  kripto: ["crypto", "hargakripto", "portofolio"],
  crypto: ["crypto", "hargakripto", "portofolio"],
  gacha: ["gachakartu", "koleksi", "open", "spin"],
  kartu: ["gachakartu", "koleksi", "blackjack", "hilow", "trade"],
  admin: ["kick", "add", "promote", "demote", "del", "warn", "unwarn", "antilink", "antispam", "antidelete", "antiraid", "grup", "hidetag", "tagall", "silent", "panel", "welcome", "goodbye"],
  moderasi: ["kick", "warn", "antilink", "antispam", "antidelete", "antiraid", "grup", "silent", "del"],
  berita: ["berita", "infogempa", "infocuaca"],
  cuaca: ["infocuaca", "infogempa"],
  kamus: ["kbbi", "kamusen", "translate", "wikipedia"],
  warna: ["color"],
  password: ["passgen", "hash", "uuid"],
  teks: ["hitungkata", "balik", "kapital", "kecil", "mock", "alay", "hilih", "style", "morse", "biner", "base64enc", "base64dec", "perbaiki", "summarize"],
  hitung: ["calc", "hitungumur", "bmi", "diskon", "splitbill", "kurs", "konversi", "countdown", "jarak"],
  lucu: ["jokes", "pantun", "gombal", "darkjokes", "tebakreceh", "roast", "bacot", "sindir", "pickup"],
  karir: ["karir", "lamar", "shift", "promosi", "resign", "kerja", "gaji"],
  startup: ["startup", "buatstartup", "rekruit", "upgradestartup", "dividen", "topstartup"],
  pinjol: ["pinjam", "bayarutang", "cekutang"],
  utang: ["pinjam", "bayarutang", "cekutang"],
  asuransi: ["asuransi", "beliasuransi", "bebaspenjara", "bebasugd"],
  penjara: ["bebaspenjara", "asuransi", "korupsi", "maling"],
  ugd: ["bebasugd", "heal", "asuransi", "serang", "russian"],
  prestige: ["prestige", "rebirth", "toprebirth", "flex", "networth"],
  flex: ["flex", "networth", "portofolio", "toprich"],
  danakaget: ["danakaget", "ambilkaget", "poinkaget", "ambilpoin", "traktir", "sedekah"],
  angpao: ["danakaget", "ambilkaget", "poinkaget", "ambilpoin", "traktir"],
  traktir: ["traktir", "danakaget", "sedekah", "topdermawan"],
  lotere: ["lotere", "belitiket", "undilotere", "jackpot"],
  jackpot: ["jackpot", "lotere", "belitiket", "undilotere", "tebakwarna", "slot", "casino"],
  balap: ["balapkuda", "balapsiput", "aduayam", "tebakwarna", "sabungpet"],
  sabung: ["sabungpet", "aduayam", "duelpoin", "duel"],
  tokopoin: ["tokopoin", "belixp", "belikotak", "buy", "buyall", "tukar"],
  sedekah: ["sedekah", "topdermawan", "traktir", "danakaget"],
  dermawan: ["topdermawan", "sedekah", "traktir", "danakaget"],
  leaderboard: ["toprich", "toprank", "toppoint", "toplevel", "topstreak", "topmenang", "topdermawan", "toprebirth", "topstartup"],
  worldboss: ["worldboss", "serangboss", "statusboss", "topdamage"],
  raid: ["worldboss", "serangboss", "statusboss", "topdamage", "dungeon"],
  boss: ["worldboss", "serangboss", "statusboss", "topdamage", "fightkucing", "fightnaga", "fightphonix"],
  skill: ["skill", "upskill", "resetskill"],
  ladang: ["ladang", "tanam", "siram", "panenladang", "pasarharga", "jualsemua"],
  tanam: ["ladang", "tanam", "siram", "panenladang", "jualsemua"],
  komoditas: ["pasarharga", "ladang", "tanam", "panenladang", "jualsemua"],
  blackmarket: ["blackmarket", "belibuff", "buffaktif", "gunakan"],
  buff: ["blackmarket", "belibuff", "buffaktif", "gunakan"],
  bounty: ["bounty", "listbounty", "burubounty"],
  buronan: ["bounty", "listbounty", "burubounty"],
  pajak: ["pajak", "pajaktop", "toprich"],
  pajaktop: ["pajaktop", "pajak", "toprich"],
};

export class FeatureSearchService {
  constructor(private readonly menu: Pick<MenuService, "getSearchableCatalog"> = menuService) {}

  search(
    rawQuery: string,
    routerCommands: readonly RouterCommandSummary[] = [],
    limit = 20,
  ): FeatureSearchResponse {
    const query = rawQuery.trim().toLowerCase().replace(/^\.+/, "");
    const catalog = this.menu.getSearchableCatalog();
    const aliasMap = new Map<string, string[]>();

    let totalWithAliases = 0;
    for (const cmd of routerCommands) {
      const lowerName = cmd.name.toLowerCase();
      const lowerAliases = cmd.aliases.map((a) => a.toLowerCase());
      aliasMap.set(lowerName, lowerAliases);
      totalWithAliases += 1 + lowerAliases.length;
    }

    if (!query) {
      return {
        query: "",
        matches: [],
        totalCatalogItems: catalog.length,
        totalRegisteredCommands: routerCommands.length,
        totalCommandsWithAliases: totalWithAliases,
      };
    }

    const tokens = query.split(/\s+/).filter((t) => t.length > 0);
    const synonymTargets = new Set<string>();
    for (const token of tokens) {
      const direct = KEYWORD_SYNONYMS[token];
      if (direct) {
        for (const t of direct) synonymTargets.add(t);
      }
      for (const [synKey, targets] of Object.entries(KEYWORD_SYNONYMS)) {
        if (synKey.includes(token) || token.includes(synKey)) {
          for (const t of targets) synonymTargets.add(t);
        }
      }
    }

    const scored: FeatureSearchMatch[] = [];
    const seenCommands = new Set<string>();

    const evaluateEntry = (entry: SearchableMenuEntry): void => {
      const cmdAliases = aliasMap.get(entry.primaryCommand) ?? [];
      const allNames = Array.from(new Set([...entry.mentionedCommands, ...cmdAliases]));
      const usageLower = entry.usage.toLowerCase();
      const catLower = entry.category.toLowerCase();

      let score = 0;
      const matchedAliases: string[] = [];

      for (const token of tokens) {
        if (entry.primaryCommand === token) {
          score += 120;
        } else if (allNames.includes(token)) {
          score += 100;
          if (cmdAliases.includes(token)) matchedAliases.push(token);
        } else if (entry.primaryCommand.startsWith(token)) {
          score += 80;
        } else if (allNames.some((n) => n.startsWith(token))) {
          score += 70;
          for (const al of cmdAliases) {
            if (al.startsWith(token)) matchedAliases.push(al);
          }
        } else if (usageLower.includes(token)) {
          score += 55;
        } else if (allNames.some((n) => n.includes(token))) {
          score += 50;
          for (const al of cmdAliases) {
            if (al.includes(token)) matchedAliases.push(al);
          }
        } else if (catLower.includes(token)) {
          score += 35;
        }
      }

      if (allNames.some((n) => synonymTargets.has(n))) {
        score += 40;
      }

      if (score > 0) {
        seenCommands.add(entry.primaryCommand);
        scored.push({
          usage: entry.usage,
          category: entry.category,
          primaryCommand: entry.primaryCommand,
          matchedAliases: Array.from(new Set(matchedAliases)),
          score,
        });
      }
    };

    for (const entry of catalog) {
      evaluateEntry(entry);
    }

    // Also match router commands not explicitly listed in public menu (e.g., owner/special commands)
    for (const cmd of routerCommands) {
      const lowerName = cmd.name.toLowerCase();
      if (seenCommands.has(lowerName)) continue;
      const lowerAliases = cmd.aliases.map((a) => a.toLowerCase());
      const allNames = [lowerName, ...lowerAliases];

      let score = 0;
      const matchedAliases: string[] = [];
      for (const token of tokens) {
        if (lowerName === token) {
          score += 110;
        } else if (lowerAliases.includes(token)) {
          score += 95;
          matchedAliases.push(token);
        } else if (allNames.some((n) => n.includes(token))) {
          score += 45;
          for (const al of lowerAliases) {
            if (al.includes(token)) matchedAliases.push(al);
          }
        }
      }

      if (score > 0) {
        seenCommands.add(lowerName);
        scored.push({
          usage: `.${lowerName}`,
          category: "SISTEM / LAINNYA",
          primaryCommand: lowerName,
          matchedAliases: Array.from(new Set(matchedAliases)),
          score,
        });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.primaryCommand.localeCompare(b.primaryCommand);
    });

    return {
      query,
      matches: scored.slice(0, limit),
      totalCatalogItems: catalog.length,
      totalRegisteredCommands: routerCommands.length,
      totalCommandsWithAliases: totalWithAliases,
    };
  }
}

export const featureSearchService = new FeatureSearchService();
