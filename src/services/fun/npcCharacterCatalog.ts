import sharp from "sharp";

import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import type { NpcCharacterGender, NpcCharacterKind } from "../rpg/rpgState";

function sanitizeSvgText(raw: string, maxLen: number): string {
  const cleaned = raw
    .replace(/[^\x20-\x7E\u00A0-\u024F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clamped = cleaned.length > maxLen ? `${cleaned.slice(0, Math.max(1, maxLen - 2))}..` : cleaned;
  return clamped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface CuratedNpcCharacter {
  key: string;
  name: string;
  aliases: readonly string[];
  sourceTitle: string;
  kind: NpcCharacterKind;
  gender: NpcCharacterGender;
  accentColor: string;
  tagline: string;
  anilistSearchHint?: string;
}

export const CURATED_GAME_CHARACTERS: readonly CuratedNpcCharacter[] = [
  // Genshin Impact
  {
    key: "game:raiden-shogun",
    name: "Raiden Shogun",
    aliases: ["raiden", "ei", "baal", "shogun"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#9333EA",
    tagline: "Archon Electro penguasa Inazuma yang anggun dan tegas.",
    anilistSearchHint: "Raiden Ei",
  },
  {
    key: "game:furina",
    name: "Furina de Fontaine",
    aliases: ["furina", "focalors"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#2563EB",
    tagline: "Bintang panggung Fontaine yang dramatis tapi lembut hati.",
  },
  {
    key: "game:hu-tao",
    name: "Hu Tao",
    aliases: ["hutao", "hu tao"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#DC2626",
    tagline: "Direktur Wangsheng yang jahil, ceria, dan penuh kejutan.",
  },
  {
    key: "game:zhongli",
    name: "Zhongli",
    aliases: ["zhongli", "morax", "rex lapis"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "male",
    accentColor: "#D97706",
    tagline: "Pria berwibawa berpengetahuan luas (walau sering lupa bawa Mora).",
  },
  {
    key: "game:ganyu",
    name: "Ganyu",
    aliases: ["ganyu"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#38BDF8",
    tagline: "Sekretaris Qixing pekerja keras dengan senyum menenangkan.",
  },
  {
    key: "game:yae-miko",
    name: "Yae Miko",
    aliases: ["yae", "yae miko", "miko"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#EC4899",
    tagline: "Guuji kuil Narukami yang cerdas dan suka menggoda.",
  },
  {
    key: "game:arlecchino",
    name: "Arlecchino",
    aliases: ["arlecchino", "knave"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#991B1B",
    tagline: "Harbinger kharismatik penuh aura elegan dan protektif.",
  },
  {
    key: "game:kazuha",
    name: "Kaedehara Kazuha",
    aliases: ["kazuha"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "male",
    accentColor: "#EF4444",
    tagline: "Samurai pengembara puitis yang tenang seperti angin musim gugur.",
  },
  {
    key: "game:xiao",
    name: "Xiao",
    aliases: ["xiao"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "male",
    accentColor: "#14B8A6",
    tagline: "Penjaga Yaksha pendiam yang diam-diam sangat peduli.",
  },
  {
    key: "game:nahida",
    name: "Nahida",
    aliases: ["nahida", "kusanali"],
    sourceTitle: "Genshin Impact",
    kind: "game",
    gender: "female",
    accentColor: "#22C55E",
    tagline: "Dewi kebijaksanaan Sumeru yang penuh rasa ingin tahu.",
  },
  // Honkai: Star Rail
  {
    key: "game:kafka",
    name: "Kafka",
    aliases: ["kafka", "kafka hsr"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "female",
    accentColor: "#A855F7",
    tagline: "Stellaron Hunter misterius berkelas yang selalu tenang.",
  },
  {
    key: "game:firefly",
    name: "Firefly",
    aliases: ["firefly", "sam hsr"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "female",
    accentColor: "#34D399",
    tagline: "Gadis hangat dari Penacony yang menyinari setiap pertemuan.",
  },
  {
    key: "game:acheron",
    name: "Acheron",
    aliases: ["acheron"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "female",
    accentColor: "#6366F1",
    tagline: "Galaxy Ranger pendiam dengan kekuatan luar biasa.",
  },
  {
    key: "game:robin-hsr",
    name: "Robin",
    aliases: ["robin hsr", "robin penacony"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "female",
    accentColor: "#F472B6",
    tagline: "Penyanyi galaksi bersuara merdu pembawa kedamaian.",
  },
  {
    key: "game:silver-wolf",
    name: "Silver Wolf",
    aliases: ["silver wolf", "silverwolf"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "female",
    accentColor: "#818CF8",
    tagline: "Hacker jenius yang menganggap semesta sebagai game seru.",
  },
  {
    key: "game:dan-heng",
    name: "Dan Heng",
    aliases: ["dan heng", "danheng", "imbibitor lunae"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "male",
    accentColor: "#0EA5E9",
    tagline: "Penjaga arsip Astral Express yang setia dan dapat diandalkan.",
  },
  {
    key: "game:jing-yuan",
    name: "Jing Yuan",
    aliases: ["jing yuan", "jingyuan"],
    sourceTitle: "Honkai: Star Rail",
    kind: "game",
    gender: "male",
    accentColor: "#F59E0B",
    tagline: "Jenderal Xianzhou santai yang penuh strategi brilian.",
  },
  // Mobile Legends: Bang Bang
  {
    key: "game:mlbb-kagura",
    name: "Kagura",
    aliases: ["kagura ml", "kagura mlbb"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "female",
    accentColor: "#38BDF8",
    tagline: "Master payung Seimei yang anggun dan gesit di Land of Dawn.",
  },
  {
    key: "game:mlbb-fanny",
    name: "Fanny",
    aliases: ["fanny", "fanny ml", "fanny mlbb"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "female",
    accentColor: "#F97316",
    tagline: "Blade Dancer cepat berkabel baja yang tak mudah dikejar.",
  },
  {
    key: "game:mlbb-guinevere",
    name: "Guinevere",
    aliases: ["guinevere", "guin"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "female",
    accentColor: "#A855F7",
    tagline: "Putri bangsawan Baroque yang ceria dan penuh energi.",
  },
  {
    key: "game:mlbb-lesley",
    name: "Lesley",
    aliases: ["lesley"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "female",
    accentColor: "#EC4899",
    tagline: "Penembak jitu elegan yang selalu menjaga jarak aman.",
  },
  {
    key: "game:mlbb-gusion",
    name: "Gusion",
    aliases: ["gusion", "gs"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "male",
    accentColor: "#3B82F6",
    tagline: "Assassin cepat penuh gaya pemberontak dari keluarga Paxley.",
  },
  {
    key: "game:mlbb-ling",
    name: "Ling",
    aliases: ["ling ml", "ling mlbb"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "male",
    accentColor: "#06B6D4",
    tagline: "Pendekar ringan yang lincah melompat di atas dinding.",
  },
  {
    key: "game:mlbb-alucard",
    name: "Alucard",
    aliases: ["alucard ml", "alucard mlbb"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "male",
    accentColor: "#2563EB",
    tagline: "Pemburu iblis klasik dengan tekad membara.",
  },
  {
    key: "game:mlbb-benedetta",
    name: "Benedetta",
    aliases: ["benedetta", "bene"],
    sourceTitle: "Mobile Legends",
    kind: "game",
    gender: "female",
    accentColor: "#64748B",
    tagline: "Shadow Ranger berpedang tajam dengan hati setia.",
  },
  // Valorant
  {
    key: "game:val-jett",
    name: "Jett",
    aliases: ["jett", "jett valorant"],
    sourceTitle: "Valorant",
    kind: "game",
    gender: "female",
    accentColor: "#38BDF8",
    tagline: "Duelist angin super percaya diri asal Seoul.",
  },
  {
    key: "game:val-sage",
    name: "Sage",
    aliases: ["sage", "sage valorant"],
    sourceTitle: "Valorant",
    kind: "game",
    gender: "female",
    accentColor: "#10B981",
    tagline: "Sentinel penyembuh tenang yang selalu siap menyelamatkan tim.",
  },
  {
    key: "game:val-reyna",
    name: "Reyna",
    aliases: ["reyna", "reyna valorant"],
    sourceTitle: "Valorant",
    kind: "game",
    gender: "female",
    accentColor: "#9333EA",
    tagline: "Duelist dominan berkharisma gelap dari Meksiko.",
  },
  {
    key: "game:val-viper",
    name: "Viper",
    aliases: ["viper", "viper valorant"],
    sourceTitle: "Valorant",
    kind: "game",
    gender: "female",
    accentColor: "#16A34A",
    tagline: "Ilmuwan kimia dingin yang penuh perhitungan.",
  },
  {
    key: "game:val-clove",
    name: "Clove",
    aliases: ["clove", "clove valorant"],
    sourceTitle: "Valorant",
    kind: "game",
    gender: "other",
    accentColor: "#E879F9",
    tagline: "Controller ceria asal Skotlandia yang tak takut mati.",
  },
  // Classic & Console / Gacha Icons
  {
    key: "game:2b",
    name: "2B (YoRHa No.2 Type B)",
    aliases: ["2b", "yorha 2b"],
    sourceTitle: "NieR: Automata",
    kind: "game",
    gender: "female",
    accentColor: "#E2E8F0",
    tagline: "Android tempur anggun yang menyimpan emosi mendalam.",
    anilistSearchHint: "YoRHa No.2 Type B",
  },
  {
    key: "game:tifa-lockhart",
    name: "Tifa Lockhart",
    aliases: ["tifa", "tifa lockhart"],
    sourceTitle: "Final Fantasy VII",
    kind: "game",
    gender: "female",
    accentColor: "#DC2626",
    tagline: "Petarung tangguh berhati hangat penjaga Seventh Heaven.",
    anilistSearchHint: "Tifa Lockhart",
  },
  {
    key: "game:aerith",
    name: "Aerith Gainsborough",
    aliases: ["aerith", "aeris"],
    sourceTitle: "Final Fantasy VII",
    kind: "game",
    gender: "female",
    accentColor: "#F472B6",
    tagline: "Penjual bunga ceria pembawa harapan dari Midgar.",
    anilistSearchHint: "Aerith Gainsborough",
  },
  {
    key: "game:cloud-strife",
    name: "Cloud Strife",
    aliases: ["cloud", "cloud strife"],
    sourceTitle: "Final Fantasy VII",
    kind: "game",
    gender: "male",
    accentColor: "#38BDF8",
    tagline: "Mantan SOLDIER pendiam pembawa Buster Sword legendaris.",
    anilistSearchHint: "Cloud Strife",
  },
  {
    key: "game:leon-kennedy",
    name: "Leon S. Kennedy",
    aliases: ["leon", "leon kennedy", "leon s kennedy"],
    sourceTitle: "Resident Evil",
    kind: "game",
    gender: "male",
    accentColor: "#2563EB",
    tagline: "Agen spesial berambut ikonik yang tetap tenang di tengah zombie.",
    anilistSearchHint: "Leon Scott Kennedy",
  },
  {
    key: "game:ada-wong",
    name: "Ada Wong",
    aliases: ["ada wong", "ada re"],
    sourceTitle: "Resident Evil",
    kind: "game",
    gender: "female",
    accentColor: "#B91C1C",
    tagline: "Mata-mata misterius bergaun merah penuh pesona.",
    anilistSearchHint: "Ada Wong",
  },
  {
    key: "game:hoshino-ba",
    name: "Takanashi Hoshino",
    aliases: ["hoshino", "hoshino ba"],
    sourceTitle: "Blue Archive",
    kind: "game",
    gender: "female",
    accentColor: "#F472B6",
    tagline: "Senpai santai Abydos yang super kuat saat melindungi juniornya.",
    anilistSearchHint: "Hoshino Takanashi",
  },
  {
    key: "game:shiroko-ba",
    name: "Sunaookami Shiroko",
    aliases: ["shiroko"],
    sourceTitle: "Blue Archive",
    kind: "game",
    gender: "female",
    accentColor: "#38BDF8",
    tagline: "Gadis serigala sporty yang hobi bersepeda (dan ide nekat).",
    anilistSearchHint: "Shiroko Sunaookami",
  },
  {
    key: "game:ranni",
    name: "Ranni the Witch",
    aliases: ["ranni", "lunar princess ranni"],
    sourceTitle: "Elden Ring",
    kind: "game",
    gender: "female",
    accentColor: "#60A5FA",
    tagline: "Putri bulan penuh misteri dari Lands Between.",
  },
  {
    key: "game:changli",
    name: "Changli",
    aliases: ["changli", "changli wuwa"],
    sourceTitle: "Wuthering Waves",
    kind: "game",
    gender: "female",
    accentColor: "#F97316",
    tagline: "Strategis Jinzhou berapi phoenix yang elegan dan memikat.",
  },
  {
    key: "game:ellen-joe",
    name: "Ellen Joe",
    aliases: ["ellen joe", "ellen zzz"],
    sourceTitle: "Zenless Zone Zero",
    kind: "game",
    gender: "female",
    accentColor: "#EF4444",
    tagline: "Maid hiu santai Victoria Housekeeping yang hobi tidur siang.",
  },
] as const;

export function findCuratedGameCharacter(rawQuery: string): CuratedNpcCharacter | null {
  const q = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return null;

  for (const c of CURATED_GAME_CHARACTERS) {
    if (c.name.toLowerCase() === q || c.aliases.includes(q)) {
      return c;
    }
  }
  if (q.length >= 4) {
    for (const c of CURATED_GAME_CHARACTERS) {
      if (
        c.name.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.length >= 4 && a.includes(q))
      ) {
        return c;
      }
    }
  }
  return null;
}

export async function renderNpcFallbackAvatar(input: {
  name: string;
  sourceTitle: string;
  kind: NpcCharacterKind;
  accentColor?: string;
}): Promise<Buffer> {
  const accent = input.accentColor ?? (input.kind === "game" ? "#38BDF8" : "#F472B6");
  const initials = input.name
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "NP";
  const safeInitials = sanitizeSvgText(initials, 3);
  const safeBadge = sanitizeSvgText(input.kind === "game" ? "GAME NPC" : "ANIME NPC", 16);
  const safeSource = sanitizeSvgText(input.sourceTitle, 22);

  const svg = Buffer.from(
    [
      `<svg width="360" height="360" xmlns="http://www.w3.org/2000/svg">`,
      `  <defs>`,
      `    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">`,
      `      <stop offset="0%" stop-color="#0F172A"/>`,
      `      <stop offset="55%" stop-color="#1E1B4B"/>`,
      `      <stop offset="100%" stop-color="${accent}"/>`,
      `    </linearGradient>`,
      `  </defs>`,
      `  <rect width="360" height="360" fill="url(#bg)"/>`,
      `  <circle cx="180" cy="155" r="96" fill="rgba(15,23,42,0.55)" stroke="${accent}" stroke-width="6"/>`,
      `  <text x="180" y="182" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="84" font-weight="bold" fill="#F8FAFC">${safeInitials}</text>`,
      `  <rect x="108" y="268" width="144" height="28" rx="14" fill="${accent}"/>`,
      `  <text x="180" y="287" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="14" font-weight="bold" fill="#0F172A">${safeBadge}</text>`,
      `  <text x="180" y="324" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="16" fill="#E2E8F0">${safeSource}</text>`,
      `</svg>`,
    ].join("\n"),
  );

  return mediaQueueService.imageComputeQueue.run(async () =>
    sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).png().toBuffer(),
  );
}
