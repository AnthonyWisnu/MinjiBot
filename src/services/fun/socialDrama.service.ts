import { createHash } from "node:crypto";

import { AppUserError } from "../../errors/appUserError";

export interface ZodiakInfo {
  name: string;
  dateRange: string;
  element: string;
  traits: string;
  compatibleWith: string;
  luckyColor: string;
}

export interface ShioInfo {
  year: number;
  shio: string;
  element: string;
  traits: string;
}

export interface WetonInfo {
  dateLabel: string;
  dayName: string;
  pasaran: string;
  wetonLabel: string;
  dayNeptu: number;
  pasaranNeptu: number;
  totalNeptu: number;
  watak: string;
}

export interface CompatibilityResult {
  percentage: number;
  verdict: string;
  bar: string;
}

export interface RamalanResult {
  rezeki: string;
  asmara: string;
  karier: string;
  angkaHoki: number;
  warnaHoki: string;
}

const ZODIAK_MAP: Record<string, ZodiakInfo> = {
  aries: {
    name: "Aries",
    dateRange: "21 Mar - 19 Apr",
    element: "Api",
    traits: "Berani, spontan, penuh energi, suka memimpin, pantang menyerah.",
    compatibleWith: "Leo, Sagitarius, Gemini",
    luckyColor: "Merah Menyala",
  },
  taurus: {
    name: "Taurus",
    dateRange: "20 Apr - 20 Mei",
    element: "Tanah",
    traits: "Setia, sabar, pekerja keras, suka kenyamanan dan kuliner enak.",
    compatibleWith: "Virgo, Capricorn, Cancer",
    luckyColor: "Hijau Zamrud",
  },
  gemini: {
    name: "Gemini",
    dateRange: "21 Mei - 20 Jun",
    element: "Udara",
    traits: "Cerdas, supel, cepat beradaptasi, jago mencairkan suasana grup.",
    compatibleWith: "Libra, Aquarius, Aries",
    luckyColor: "Kuning Cerah",
  },
  cancer: {
    name: "Cancer",
    dateRange: "21 Jun - 22 Jul",
    element: "Air",
    traits: "Peka, penyayang, protektif pada teman dekat, intuisi kuat.",
    compatibleWith: "Scorpio, Pisces, Taurus",
    luckyColor: "Putih Perak",
  },
  leo: {
    name: "Leo",
    dateRange: "23 Jul - 22 Agu",
    element: "Api",
    traits: "Karismatik, percaya diri, dermawan, suka jadi pusat perhatian.",
    compatibleWith: "Aries, Sagitarius, Libra",
    luckyColor: "Emas",
  },
  virgo: {
    name: "Virgo",
    dateRange: "23 Agu - 22 Sep",
    element: "Tanah",
    traits: "Teliti, perfeksionis, analitis, paling bisa diandalkan saat genting.",
    compatibleWith: "Taurus, Capricorn, Scorpio",
    luckyColor: "Biru Dongker",
  },
  libra: {
    name: "Libra",
    dateRange: "23 Sep - 22 Okt",
    element: "Udara",
    traits: "Adil, diplomatis, estetis, penengah terbaik saat grup ribut.",
    compatibleWith: "Gemini, Aquarius, Leo",
    luckyColor: "Biru Pastel",
  },
  scorpio: {
    name: "Scorpio",
    dateRange: "23 Okt - 21 Nov",
    element: "Air",
    traits: "Misterius, fokus tinggi, setia pada sahabat, daya juang baja.",
    compatibleWith: "Cancer, Pisces, Virgo",
    luckyColor: "Hitam & Merah Marun",
  },
  sagitarius: {
    name: "Sagitarius",
    dateRange: "22 Nov - 21 Des",
    element: "Api",
    traits: "Optimis, humoris, cinta kebebasan, selalu siap diajak jalan.",
    compatibleWith: "Aries, Leo, Aquarius",
    luckyColor: "Ungu",
  },
  capricorn: {
    name: "Capricorn",
    dateRange: "22 Des - 19 Jan",
    element: "Tanah",
    traits: "Ambisius, disiplin, matang, fokus menabung dan membangun masa depan.",
    compatibleWith: "Taurus, Virgo, Pisces",
    luckyColor: "Cokelat Gelap",
  },
  aquarius: {
    name: "Aquarius",
    dateRange: "20 Jan - 18 Feb",
    element: "Udara",
    traits: "Visioner, unik, anti-mainstream, penuh ide liar yang jenius.",
    compatibleWith: "Gemini, Libra, Sagitarius",
    luckyColor: "Biru Elektrik",
  },
  pisces: {
    name: "Pisces",
    dateRange: "19 Feb - 20 Mar",
    element: "Air",
    traits: "Kreatif, empatik, romantis, imajinatif dan lembut hati.",
    compatibleWith: "Cancer, Scorpio, Capricorn",
    luckyColor: "Toska",
  },
};

const SHIO_LIST = [
  { shio: "Tikus", traits: "Cerdik, gesit mencari peluang, hemat dan penuh strategi." },
  { shio: "Kerbau", traits: "Tangguh, jujur, sabar, dan konsisten sampai target tercapai." },
  { shio: "Macan", traits: "Berani, karismatik, kompetitif, dan berjiwa pemimpin." },
  { shio: "Kelinci", traits: "Halus, diplomatis, beruntung, dan disukai banyak orang." },
  { shio: "Naga", traits: "Ambisius, penuh daya tarik, energik, dan pembawa hoki besar." },
  { shio: "Ular", traits: "Bijaksana, tenang, tajam membaca situasi, dan elegan." },
  { shio: "Kuda", traits: "Bebas, ceria, cepat bertindak, dan semangat pantang padam." },
  { shio: "Kambing", traits: "Kreatif, lembut, penuh empati, dan mencintai kedamaian." },
  { shio: "Monyet", traits: "Humoris, pintar berimprovisasi, serba bisa, dan ramah." },
  { shio: "Ayam", traits: "Disiplin, percaya diri, jujur apa adanya, dan teliti." },
  { shio: "Anjing", traits: "Sangat setia, adil, dapat dipercaya, dan pelindung sejati." },
  { shio: "Babi", traits: "Dermawan, tulus, menikmati hidup, dan magnet rezeki." },
] as const;

const SHIO_ELEMENTS = ["Logam", "Logam", "Air", "Air", "Kayu", "Kayu", "Api", "Api", "Tanah", "Tanah"] as const;

const JAVA_DAYS = [
  { name: "Minggu", neptu: 5 },
  { name: "Senin", neptu: 4 },
  { name: "Selasa", neptu: 3 },
  { name: "Rabu", neptu: 7 },
  { name: "Kamis", neptu: 8 },
  { name: "Jumat", neptu: 6 },
  { name: "Sabtu", neptu: 9 },
] as const;

// 1970-01-01 adalah Kamis Wage (index Wage = 3 dalam urutan Legi=0, Pahing=1, Pon=2, Wage=3, Kliwon=4)
// Verifikasi: 1945-08-17 -> hari Jumat, selisih hari dari 1970-01-01 = -8903 hari; ((-8903 + 3) % 5 + 5) % 5 = 0 -> Legi => Jumat Legi!
const JAVA_PASARAN = [
  { name: "Legi", neptu: 5 },
  { name: "Pahing", neptu: 9 },
  { name: "Pon", neptu: 7 },
  { name: "Wage", neptu: 4 },
  { name: "Kliwon", neptu: 8 },
] as const;

const MEMBER_FACTS = [
  "Diam-diam sering baca chat grup tanpa balas (sider elit).",
  "Kalau diajak nongkrong bilang OTW padahal baru bangun tidur.",
  "Punya bakat terpendam jadi sultan tapi selalu habis buat jajan kopi.",
  "Sangat diandalkan kalau grup lagi sepi buat lempar stiker random.",
  "Sering bilang 'bentar lagi tidur' jam 10 malam, tapi masih online jam 2 pagi.",
  "Kalau main slot di grup selalu yakin spin berikutnya bakal Super Jackpot.",
  "Diam-diam punya 100+ stiker aib teman di galeri HP.",
  "Tipe orang yang kalau makan mie instan selalu kurang kalau cuma satu bungkus.",
  "Paling cepat muncul begitu ada kata 'traktir' atau 'bansos' di grup.",
  "Auranya tenang di luar, tapi di dalam lagi mikirin mau makan apa nanti malam.",
  "Calon miliarder grup yang tinggal nunggu hoki gacha peti Legendary.",
  "Kalau chat di grup selalu jadi penyeimbang antara waras dan chaos.",
] as const;

const RAMALAN_REZEKI = [
  "Lancar deras! Coba klaim .daily dan .adventure hari ini.",
  "Ada kejutan rezeki tak terduga dari arah yang tidak disangka.",
  "Stabil dan aman, cocok buat nabung di .atm dulu daripada all-in.",
  "Hoki lagi naik daun! Peluang cuan besar terbuka lebar.",
  "Sedikit boros buat jajan, tapi kebahagiaan tetap nomor satu.",
] as const;

const RAMALAN_ASMARA = [
  "Ada yang diam-diam memperhatikan chat-mu hari ini.",
  "Komunikasi makin hangat, cocok buat lempar kode tipis-tipis.",
  "Fokus mencintai diri sendiri dulu, jodoh sedang menuju titik temu.",
  "Aura karismamu lagi maksimal, siap-siap banyak yang kepo.",
  "Jangan gengsi menyapa duluan, obrolan seru menanti!",
] as const;

const RAMALAN_KARIER = [
  "Ide cemerlangmu hari ini bakal diapresiasi banyak orang.",
  "Kerjaan atau tugas numpuk, tapi selesai mulus kalau dikerjakan satu per satu.",
  "Waktu yang tepat buat belajar skill baru atau mulai proyek kecil.",
  "Kolaborasi bareng teman hari ini bawa hasil jauh lebih maksimal.",
] as const;

const LUCKY_COLORS = [
  "Biru Langit",
  "Emas Sultan",
  "Hijau Mint",
  "Ungu Neon",
  "Hitam Elegan",
  "Merah Marun",
  "Putih Bersih",
  "Oranye Senja",
] as const;

function stableHashInt(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0);
}

function getJakartaDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function renderProgressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${String(pct)}%`;
}

export class SocialDramaService {
  pickRandomMembers<T>(pool: readonly T[], count: number): T[] {
    if (pool.length === 0) {
      throw new AppUserError("Daftar anggota grup tidak dapat dibaca saat ini.");
    }
    const clamped = Math.max(1, Math.min(count, pool.length));
    const arr = [...pool];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      const swap = arr[j];
      if (tmp !== undefined && swap !== undefined) {
        arr[i] = swap;
        arr[j] = tmp;
      }
    }
    return arr.slice(0, clamped);
  }

  computeCompatibility(idA: string, idB: string): CompatibilityResult {
    const pair = [idA.toLowerCase(), idB.toLowerCase()].sort().join("::");
    const pct = (stableHashInt(`ship::${pair}`) % 100) + 1;
    let verdict: string;
    if (pct >= 90) {
      verdict = "Jodoh Sejati! Langsung gas .nikah aja!";
    } else if (pct >= 75) {
      verdict = "Cocok Banget! Chemistry-nya bukan main.";
    } else if (pct >= 55) {
      verdict = "Lumayan Serasi, tinggal sering ngobrol bareng.";
    } else if (pct >= 35) {
      verdict = "Masih Friendzone Tipis-Tipis, perlu usaha ekstra.";
    } else {
      verdict = "Mending jadi bestie atau partner mabar aja dulu wkwk.";
    }
    return { percentage: pct, verdict, bar: renderProgressBar(pct) };
  }

  getMemberFact(targetId: string): string {
    const idx = stableHashInt(`fact::${targetId}::${getJakartaDateKey()}`) % MEMBER_FACTS.length;
    return MEMBER_FACTS[idx] ?? MEMBER_FACTS[0];
  }

  getDailyRamalan(targetId: string, now = new Date()): RamalanResult {
    const dayKey = getJakartaDateKey(now);
    const h = stableHashInt(`ramalan::${targetId}::${dayKey}`);
    return {
      rezeki: RAMALAN_REZEKI[h % RAMALAN_REZEKI.length] ?? RAMALAN_REZEKI[0],
      asmara: RAMALAN_ASMARA[(h >>> 4) % RAMALAN_ASMARA.length] ?? RAMALAN_ASMARA[0],
      karier: RAMALAN_KARIER[(h >>> 8) % RAMALAN_KARIER.length] ?? RAMALAN_KARIER[0],
      angkaHoki: (h % 99) + 1,
      warnaHoki: LUCKY_COLORS[(h >>> 12) % LUCKY_COLORS.length] ?? LUCKY_COLORS[0],
    };
  }

  getZodiak(rawName: string): ZodiakInfo {
    const key = rawName.trim().toLowerCase();
    const info = ZODIAK_MAP[key];
    if (!info) {
      throw new AppUserError(
        "Zodiak tidak dikenali. Pilih: aries, taurus, gemini, cancer, leo, virgo, libra, scorpio, sagitarius, capricorn, aquarius, pisces.",
      );
    }
    return info;
  }

  getShio(year: number): ShioInfo {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new AppUserError("Masukkan tahun lahir yang valid antara 1900 sampai 2100. Contoh: *.shio 2002*");
    }
    // 1900 = Tikus (index 0)
    const idx = (((year - 1900) % 12) + 12) % 12;
    const entry = SHIO_LIST[idx] ?? SHIO_LIST[0];
    const element = SHIO_ELEMENTS[year % 10] ?? "Kayu";
    return {
      year,
      shio: entry.shio,
      element,
      traits: entry.traits,
    };
  }

  calculateWeton(rawDate: string): WetonInfo {
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(rawDate.trim());
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new AppUserError(
        "Format tanggal salah. Gunakan DD-MM-YYYY.\nContoh: *.weton 17-08-1945*",
      );
    }

    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
      throw new AppUserError("Tanggal tidak valid. Gunakan format DD-MM-YYYY (tahun 1900-2100).");
    }

    const utcMs = Date.UTC(year, month - 1, day);
    const d = new Date(utcMs);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      throw new AppUserError("Tanggal kalender tersebut tidak ada.");
    }

    const dayIdx = d.getUTCDay(); // 0=Minggu .. 6=Sabtu
    const daysSinceEpoch = Math.floor(utcMs / 86_400_000);
    const pasaranIdx = (((daysSinceEpoch + 3) % 5) + 5) % 5;

    const dayInfo = JAVA_DAYS[dayIdx] ?? JAVA_DAYS[0];
    const pasaranInfo = JAVA_PASARAN[pasaranIdx] ?? JAVA_PASARAN[0];
    const totalNeptu = dayInfo.neptu + pasaranInfo.neptu;

    let watak: string;
    if (totalNeptu >= 16) {
      watak = "Berwibawa tinggi, rezeki luas, berjiwa pemimpin, dan mudah disegani.";
    } else if (totalNeptu >= 13) {
      watak = "Cerdas, ulet, pandai bergaul, dan membawa keberuntungan bagi lingkungan sekitar.";
    } else if (totalNeptu >= 10) {
      watak = "Tenang, teliti, setia kawan, dan rezekinya mengalir stabil.";
    } else {
      watak = "Sederhana, rendah hati, tekun, dan tajam intuisinya.";
    }

    const dateLabel = `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${String(year)}`;
    return {
      dateLabel,
      dayName: dayInfo.name,
      pasaran: pasaranInfo.name,
      wetonLabel: `${dayInfo.name} ${pasaranInfo.name}`,
      dayNeptu: dayInfo.neptu,
      pasaranNeptu: pasaranInfo.neptu,
      totalNeptu,
      watak,
    };
  }
}

export const socialDramaService = new SocialDramaService();
