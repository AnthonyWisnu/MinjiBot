import { AppUserError } from "../../errors/appUserError";
import { BoundedTtlCache } from "../../utils/ttlCache";
import { safeFetchExternal } from "../../utils/urlValidator";
import { ASMAUL_HUSNA, AYAT_KURSI, SURAH_NAMES, type AsmaulHusnaItem } from "./islamiData";

interface EquranAyat {
  nomorAyat: number;
  teksArab: string;
  teksLatin: string;
  teksIndonesia: string;
}

interface EquranSurahData {
  nomor: number;
  nama: string;
  namaLatin: string;
  jumlahAyat: number;
  tempatTurun: string;
  arti: string;
  ayat: EquranAyat[];
}

export interface AlQuranResult {
  surahNumber: number;
  surahNameLatin: string;
  surahNameArabic: string;
  meaning: string;
  totalAyat: number;
  revelation: string;
  ayatList: EquranAyat[];
}

export interface JadwalShalatResult {
  lokasi: string;
  daerah: string;
  tanggal: string;
  imsak: string;
  subuh: string;
  terbit: string;
  dhuha: string;
  dzuhur: string;
  ashar: string;
  maghrib: string;
  isya: string;
}

function normalizeSurahKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveSurahNumber(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const num = Number.parseInt(trimmed, 10);
    return num >= 1 && num <= 114 ? num : null;
  }

  const key = normalizeSurahKey(trimmed);
  const exactIdx = SURAH_NAMES.findIndex((name) => normalizeSurahKey(name) === key);
  if (exactIdx >= 0) return exactIdx + 1;

  const partialIdx = SURAH_NAMES.findIndex((name) => normalizeSurahKey(name).includes(key));
  return partialIdx >= 0 ? partialIdx + 1 : null;
}

function formatJakartaDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return { year, month, day };
}

export class IslamiService {
  private readonly surahCache = new BoundedTtlCache<EquranSurahData>(60, 30 * 60 * 1000);
  private readonly shalatCache = new BoundedTtlCache<JadwalShalatResult>(100, 30 * 60 * 1000);

  constructor(private readonly fetchFn: typeof safeFetchExternal = safeFetchExternal) {}

  async getAlQuran(surahInput: string, ayatSpec?: string): Promise<AlQuranResult> {
    const surahNumber = resolveSurahNumber(surahInput);
    if (!surahNumber) {
      throw new AppUserError(
        "Surah tidak ditemukan. Masukkan nomor 1-114 atau nama surah (contoh: *.alquran 1 1* atau *.alquran yasin 1-3*).",
      );
    }

    const cacheKey = `surah:${String(surahNumber)}`;
    let surah = this.surahCache.get(cacheKey);
    if (!surah) {
      const resp = await this.fetchFn(`https://equran.id/api/v2/surat/${String(surahNumber)}`, {
        allowedDomains: ["equran.id"],
        headers: { Accept: "application/json", "User-Agent": "MinjiBot-V2" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        throw new AppUserError("Layanan Al-Quran sedang sibuk. Silakan coba beberapa saat lagi.");
      }

      const payload = (await resp.json()) as { data?: EquranSurahData };
      if (!payload.data?.ayat) {
        throw new AppUserError("Data surah tidak dapat dibaca.");
      }
      surah = payload.data;
      this.surahCache.set(cacheKey, surah);
    }

    let start = 1;
    let end = Math.min(3, surah.jumlahAyat);

    if (ayatSpec?.trim()) {
      const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(ayatSpec.trim());
      if (!rangeMatch?.[1]) {
        throw new AppUserError("Format ayat tidak valid. Contoh: *.alquran 2 255* atau *.alquran 112 1-4*.");
      }
      start = Number.parseInt(rangeMatch[1], 10);
      end = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : start;
      if (start < 1 || end < start || start > surah.jumlahAyat) {
        throw new AppUserError(
          `Surah ${surah.namaLatin} hanya memiliki ${String(surah.jumlahAyat)} ayat.`,
        );
      }
      end = Math.min(end, surah.jumlahAyat, start + 4); // Maksimal 5 ayat per pesan agar rapi di HP
    }

    const ayatList = surah.ayat.filter((a) => a.nomorAyat >= start && a.nomorAyat <= end);
    return {
      surahNumber: surah.nomor,
      surahNameLatin: surah.namaLatin,
      surahNameArabic: surah.nama,
      meaning: surah.arti,
      totalAyat: surah.jumlahAyat,
      revelation: surah.tempatTurun,
      ayatList,
    };
  }

  async getJadwalShalat(rawCity: string, now = new Date()): Promise<JadwalShalatResult> {
    const city = rawCity.trim();
    if (city.length < 2 || city.length > 60) {
      throw new AppUserError("Masukkan nama kota yang valid. Contoh: *.jadwalshalat jakarta*");
    }

    const { year, month, day } = formatJakartaDateParts(now);
    const cacheKey = `${city.toLowerCase()}:${year}-${month}-${day}`;
    const cached = this.shalatCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const searchResp = await this.fetchFn(
      `https://api.myquran.com/v2/sholat/kota/cari/${encodeURIComponent(city)}`,
      {
        allowedDomains: ["api.myquran.com"],
        headers: { Accept: "application/json", "User-Agent": "MinjiBot-V2" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!searchResp.ok) {
      throw new AppUserError("Gagal menghubungi layanan jadwal shalat. Coba lagi sebentar ya.");
    }

    const searchJson = (await searchResp.json()) as {
      status?: boolean;
      data?: { id: string; lokasi: string }[];
    };
    const firstCity = searchJson.data?.[0];
    if (!searchJson.status || !firstCity) {
      throw new AppUserError(`Kota *${city}* tidak ditemukan di database Kemenag/MyQuran.`);
    }

    const schedResp = await this.fetchFn(
      `https://api.myquran.com/v2/sholat/jadwal/${encodeURIComponent(firstCity.id)}/${year}/${month}/${day}`,
      {
        allowedDomains: ["api.myquran.com"],
        headers: { Accept: "application/json", "User-Agent": "MinjiBot-V2" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!schedResp.ok) {
      throw new AppUserError("Gagal mengambil jadwal shalat hari ini.");
    }

    const schedJson = (await schedResp.json()) as {
      status?: boolean;
      data?: {
        lokasi: string;
        daerah: string;
        jadwal: {
          tanggal: string;
          imsak: string;
          subuh: string;
          terbit: string;
          dhuha: string;
          dzuhur: string;
          ashar: string;
          maghrib: string;
          isya: string;
        };
      };
    };

    const data = schedJson.data;
    if (!schedJson.status || !data) {
      throw new AppUserError("Jadwal shalat untuk kota tersebut belum tersedia.");
    }

    const result: JadwalShalatResult = {
      lokasi: data.lokasi,
      daerah: data.daerah,
      tanggal: data.jadwal.tanggal,
      imsak: data.jadwal.imsak,
      subuh: data.jadwal.subuh,
      terbit: data.jadwal.terbit,
      dhuha: data.jadwal.dhuha,
      dzuhur: data.jadwal.dzuhur,
      ashar: data.jadwal.ashar,
      maghrib: data.jadwal.maghrib,
      isya: data.jadwal.isya,
    };

    this.shalatCache.set(cacheKey, result);
    return result;
  }

  getAsmaulHusnaByNumber(num: number): AsmaulHusnaItem {
    const item = ASMAUL_HUSNA[num - 1];
    if (!item) {
      throw new AppUserError("Nomor Asmaul Husna harus antara 1 sampai 99.");
    }
    return item;
  }

  getAsmaulHusnaPage(page: number): { page: number; totalPages: number; items: readonly AsmaulHusnaItem[] } {
    const perPage = 33;
    const totalPages = Math.ceil(ASMAUL_HUSNA.length / perPage);
    if (page < 1 || page > totalPages) {
      throw new AppUserError(`Halaman daftar Asmaul Husna hanya 1 sampai ${String(totalPages)}.`);
    }
    const start = (page - 1) * perPage;
    return {
      page,
      totalPages,
      items: ASMAUL_HUSNA.slice(start, start + perPage),
    };
  }

  getRandomAsmaulHusna(): AsmaulHusnaItem {
    const idx = Math.floor(Math.random() * ASMAUL_HUSNA.length);
    return (
      ASMAUL_HUSNA[idx] ??
      ASMAUL_HUSNA[0] ?? {
        number: 1,
        arabic: "الرَّحْمَنُ",
        latin: "Ar-Rahman",
        meaning: "Yang Maha Pengasih",
      }
    );
  }

  getAyatKursi(): typeof AYAT_KURSI {
    return AYAT_KURSI;
  }
}

export const islamiService = new IslamiService();
