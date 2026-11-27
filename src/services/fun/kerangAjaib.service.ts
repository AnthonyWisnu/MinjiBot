import { toWibDateKey } from "../../utils/wibDate";

export type FunCheckType =
  | "ganteng"
  | "cantik"
  | "bucin"
  | "wibu"
  | "pintar"
  | "gabut"
  | "jones"
  | "sadboy"
  | "stress"
  | "hoki"
  | "sultan";

export interface FunCheckMeta {
  title: string;
  lowComment: string;
  midComment: string;
  highComment: string;
  maxComment: string;
}

const CHECK_METADATA: Record<FunCheckType, FunCheckMeta> = {
  ganteng: {
    title: "CEK GANTENG",
    lowComment: "Tenang, ganteng itu relatif... mungkin cahayanya aja lagi kurang pas.",
    midComment: "Lumayan manis, cocok jadi menantu idaman tetangga sebelah.",
    highComment: "Aura oppa Korea mulai terpancar, hati-hati banyak yang ngelirik!",
    maxComment: "SPEK DEWA! Lewat depan cermin aja cerminnya langsung insecure!",
  },
  cantik: {
    title: "CEK CANTIK",
    lowComment: "Cantik dari dalam hati itu yang paling penting, tetap semangat!",
    midComment: "Manis dan adem dilihat, bikin suasana grup jadi tenang.",
    highComment: "Pesona bidadari lokal! Sekali senyum langsung bikin salah fokus.",
    maxComment: "CANTIK MAKSIMAL! Filter kamera aja nyerah karena aslinya udah bening!",
  },
  bucin: {
    title: "CEK BUCIN",
    lowComment: "Hati sedingin kulkas Indomaret, susah banget dibikin baper.",
    midComment: "Bucin secukupnya, masih bisa mikir jernih pas lagi sayang.",
    highComment: "Dikasih stiker love dikit aja langsung senyum-senyum sendiri seharian!",
    maxComment: "BUCIN AKUT STADIUM AKHIR! Chat belum dibalas 2 menit udah bikin puisi galau!",
  },
  wibu: {
    title: "CEK WIBU",
    lowComment: "Warga sipil normal, nonton anime cuma pas lewat di FYP.",
    midComment: "Penikmat anime santai, hapal beberapa opening legendaris.",
    highComment: "Kamar penuh poster, tiap ngobrol hampir keceplosan bilang 'nani'!",
    maxComment: "WIBU ELITE! Sudah siap dipanggil isekai sambil bawa bantal waifu!",
  },
  pintar: {
    title: "CEK PINTAR",
    lowComment: "Otak lagi mode hemat baterai, perlu asupan kopi dulu.",
    midComment: "Cukup cerdas dan tanggap, cocok jadi andalan saat main kuis grup.",
    highComment: "IQ di atas rata-rata! Soal matematika aja dilihat kayak soal TK.",
    maxComment: "JENIUS MUTLAK! Einstein pun ikut tepuk tangan lihat skormu hari ini!",
  },
  gabut: {
    title: "CEK GABUT",
    lowComment: "Sok sibuk banget hari ini, jadwal padat kayak CEO.",
    midComment: "Agak senggang, masih sempat scroll chat grup sambil rebahan.",
    highComment: "Tingkat kegabutan tinggi! Sampai ngitungin butiran nasi di piring.",
    maxComment: "RAJA GABUT! Tiap 3 detik buka tutup WA padahal gak ada chat baru!",
  },
  jones: {
    title: "CEK JONES",
    lowComment: "Aura gebetan melimpah, kayaknya bentar lagi bakal ganti status!",
    midComment: "Masih santai menikmati kebebasan jomblo berkualitas.",
    highComment: "Malam minggu ditemani kipas angin dan playlist galau.",
    maxComment: "JONES LEGENDARIS! Notifikasi paling mesra cuma dari operator pulsa!",
  },
  sadboy: {
    title: "CEK SADBOY / GALAU",
    lowComment: "Lagi happy banget hari ini, gak ada kata galau di kamusmu.",
    midComment: "Sedikit mellow pas denger lagu akustik, tapi masih aman terkendali.",
    highComment: "Tatapan kosong ke jendela sambil ngerasa jadi tokoh utama MV sedih.",
    maxComment: "GALAU MAKSIMAL! Lagi hujan dikit langsung nulis caption puitis panjang!",
  },
  stress: {
    title: "CEK TINGKAT STRESS",
    lowComment: "Santai banget hidupmu hari ini, serasa liburan di pantai.",
    midComment: "Ada beban pikiran dikit, tapi masih bisa ketawa di grup.",
    highComment: "Butuh healing segera! Jangan lupa minum air putih dan istirahat.",
    maxComment: "OVERHEAT! Otak udah ngebul, wajib rehat dan jajan enak sekarang juga!",
  },
  hoki: {
    title: "CEK HOKI HARI INI",
    lowComment: "Hati-hati kalau mau .korupsi atau .casino hari ini, lagi rawan apes!",
    midComment: "Keberuntungan standar, cocok buat cari cuan halal dulu.",
    highComment: "Lagi wangi banget! Coba main .bom, .nambang, atau .slot hari ini!",
    maxComment: "HOKI DEWA! Sekali gacha rasanya bakal langsung jackpot semua!",
  },
  sultan: {
    title: "CEK AURA SULTAN",
    lowComment: "Dompet lagi diet ketat, yuk gas .mulung atau .bansos dulu!",
    midComment: "Ekonomi stabil, bisa jajan kopi susu tanpa mikir dua kali.",
    highComment: "Aura bos besar mulai kelihatan! Siap-siap jadi target .pajak warga!",
    maxComment: "SULTAN ABADI! Beli es teh aja rasanya pengen sekalian sama gerobaknya!",
  },
};

const APAKAH_ANSWERS = [
  "Iya, jelas banget!",
  "Pasti dong, gaskeun!",
  "Besar kemungkinan iya.",
  "Kayaknya sih iya, tapi jangan terlalu yakin dulu.",
  "50:50 nih, tergantung niatmu.",
  "Hmm... coba tanya lagi habis minum es teh.",
  "Kayaknya enggak deh.",
  "Tidak, jangan ngarep terlalu tinggi ya.",
  "Mustahil banget, mending tidur aja.",
  "Menurut Kerang Ajaib: YA, 100%!",
  "Menurut Kerang Ajaib: TIDAK!",
  "Bisa jadi, kalau kamu rajin usaha.",
] as const;

const KAPAN_ANSWERS = [
  "Hari ini juga, siap-siap!",
  "Besok pagi pas kamu baru bangun tidur.",
  "3 hari lagi, tandai kalendermu!",
  "Minggu depan kalau cuaca mendukung.",
  "Bulan depan pas gajian cair.",
  "Tahun depan... sabar ya!",
  "Sekitar 2 jam lagi dari sekarang.",
  "5 tahun lagi, jangan lupa nabung dulu.",
  "Saat kamu berhenti rebahan dan mulai gerak!",
  "Nanti pas grup ini udah tembus 1 juta pesan.",
  "Malam ini jam 23:59 WIB.",
  "Kapan-kapan kalau semesta lagi mood bagus.",
] as const;

export interface KhodamEntry {
  name: string;
  power: string;
  desc: string;
}

const KHODAM_LIST: readonly KhodamEntry[] = [
  { name: "Macan Cisewu", power: "SS+", desc: "Senyumnya bikin musuh lupa mau marah." },
  { name: "Kulkas 2 Pintu", power: "A", desc: "Dingin di luar, tapi selalu nyimpen makanan enak di dalam." },
  { name: "Kucing Oren Pemilik Komplek", power: "SSS", desc: "Bar-bar, tidak takut siapapun, selalu menang debat." },
  { name: "Sandal Jepit Putus", power: "C", desc: "Tampak rapuh tapi sakit banget kalau dilempar emak." },
  { name: "Naga Indosiar", power: "SSS+", desc: "Terbang penuh efek CGI dan selalu datang saat momen dramatis." },
  { name: "Tutup Panci Berkarat", power: "B", desc: "Pertahanan tingkat tinggi, suara nyaring kalau jatuh." },
  { name: "Tuyul Mohawk", power: "S", desc: "Gaya punk, ahli berburu recehan di kas grup." },
  { name: "Kipas Angin Maspion", power: "A+", desc: "Bikin adem suasana grup walau tombol nomor 3 udah longgar." },
  { name: "Galon Kosong", power: "B+", desc: "Suaranya nyaring kalau digetok, cocok buat nge-roasting." },
  { name: "Kecoa Terbang", power: "SSS", desc: "Satu kepakan sayap cukup bikin orang terkuat pun kabur." },
  { name: "Batu Baterai ABC", power: "A", desc: "Tahan lama begadang sampai jam 3 pagi." },
  { name: "Bakwan Jagung Hangat", power: "S", desc: "Selalu dicari saat nongkrong, bikin semua orang suka." },
  { name: "Kursi Plastik Kondangan", power: "A+", desc: "Kokoh menopang beban hidup dan gosip grup." },
  { name: "Spion Motor Miring", power: "B", desc: "Suka melirik masa lalu tapi tetap melaju ke depan." },
  { name: "Charger Kendor", power: "C+", desc: "Harus dipepetin di sudut tertentu biar mau jalan." },
  { name: "Cicak Nempel di Dinding", power: "A", desc: "Silent reader sejati, cuma mantau lalu tiba-tiba muncul." },
  { name: "Pecel Lele Lamongan", power: "S+", desc: "Energi malam yang tak pernah mengecewakan." },
  { name: "Kunti Bogel", power: "S", desc: "Ketawanya nular dan sering nongol tengah malam di grup." },
  { name: "Gelas Belimbing", power: "A", desc: "Klasik, legendaris, cocok isi teh manis maupun kopi tubruk." },
  { name: "Helm Bogo Kaca Gelap", power: "A+", desc: "Misterius, anti silau melihat masa depan." },
  { name: "Kerupuk Kaleng Warung", power: "B+", desc: "Renyah, tapi cepat melempem kalau lupa ditutup." },
  { name: "Sapu Lidi Sakti", power: "S", desc: "Ampuh menyapu bersih komentar nyinyir." },
  { name: "Bebek Karet", power: "B", desc: "Imut, bunyi nyaring kalau dipencet, bikin rileks." },
  { name: "Pocong Naik Vespa", power: "SS", desc: "Gerak cepat melintasi timeline chat dengan gaya retro." },
  { name: "Kabel Roll Kusut", power: "B", desc: "Kelihatannya ribet tapi jadi penyelamat saat butuh colokan." },
  { name: "Baskom Hajatan", power: "A", desc: "Selalu pulang bawa berkat dari acara mana saja." },
  { name: "Ayam Jago Jam 3 Pagi", power: "S", desc: "Alarm alami yang bunyinya nggak pernah minta izin." },
  { name: "Es Teh Plastik Ikat Karet", power: "SS", desc: "Sederhana tapi selalu jadi penyemangat hidup." },
  { name: "Kompor Gas Lupa Dimatiin", power: "S+", desc: "Bikin panik seketika tapi bikin orang jadi sigap." },
  { name: "Capybara Santai", power: "SSS", desc: "Tidak peduli drama apa pun, tetap chill 24/7." },
  { name: "Mio Mirza", power: "SS+", desc: "Kecepatan tak tertandingi, melesat duluan sebelum start." },
  { name: "Tahu Bulat Digoreng Dadakan", power: "S+", desc: "Muncul mendadak dengan jingle yang nempel di kepala." },
  { name: "Kambing Guling", power: "SS", desc: "Rebutan warga saat ada momen syukuran." },
  { name: "Garpu Somay", power: "B+", desc: "Kecil-kecil tajam, jago menusuk fakta." },
  { name: "Guling Kempes", power: "A", desc: "Meski tipis tetap paling nyaman dipeluk pas hujan." },
  { name: "Lampu Disko Angkot", power: "S", desc: "Meriah terus walau keadaan lagi macet." },
  { name: "Kaleng Khong Guan Isi Rengginang", power: "SS+", desc: "Ahli plot twist! Penampilan menipu, isinya tak terduga." },
  { name: "Botol Marjan Lebaran", power: "A+", desc: "Ikonik, cuma muncul di momen spesial." },
  { name: "Tukang Parkir Gaib", power: "SSS", desc: "Pas datang gak kelihatan, pas mau pergi tiba-tiba ada di belakang." },
  { name: "WiFi Tetangga", power: "S", desc: "Sinyalnya timbul tenggelam tapi selalu diharapkan." },
];

const TRUTH_LIST: readonly string[] = [
  "Siapa orang terakhir yang bikin kamu senyum-senyum sendiri pas baca chat?",
  "Pernah pura-pura ketiduran cuma biar gak usah balas chat seseorang? Ceritakan!",
  "Apa kebiasaan paling aneh yang cuma kamu lakukan pas sendirian di kamar?",
  "Kalau boleh hapus 1 momen paling memalukan di hidupmu, momen apa itu?",
  "Siapa member di grup ini yang paling sering bikin kamu ketawa?",
  "Pernah naksir teman sendiri tapi cuma dipendam sampai sekarang?",
  "Apa hal paling receh yang pernah bikin kamu nangis atau kesal berat?",
  "Jujur, berapa lama rekor paling lama kamu tidak mandi pas libur?",
  "Pernah kirim pesan salah grup yang bikin panik setengah mati? Isinya apa?",
  "Kalau tiba-tiba dapat Rp 1 Miliar hari ini, 3 hal pertama yang kamu beli apa?",
  "Siapa di grup ini yang menurutmu paling jago ngeles?",
  "Apa kebohongan paling klasik yang pernah kamu ucapkan ke orang tua atau guru/bos?",
  "Pernah stalking akun mantan atau gebetan pakai akun kedua?",
  "Makanan aneh apa yang kamu suka tapi orang lain biasanya geli lihatnya?",
  "Kalau harus terjebak di pulau terpencil bareng 1 orang dari grup ini, kamu pilih siapa?",
  "Apa ketakutan terbesarmu yang jarang diketahui orang lain?",
  "Pernah pura-pura sibuk biar gak ikut nongkrong?",
  "Sebutkan 1 sifatmu yang pengen banget kamu ubah tahun ini!",
  "Lagu paling galau apa yang diam-diam sering kamu putar ulang?",
  "Jujur, kamu tipe yang lebih sering jadi silent reader atau paling berisik di grup?",
  "Pernah lupa nama orang padahal udah ngobrol akrab banget?",
  "Apa pembelian online paling gak berguna yang pernah kamu checkout tengah malam?",
  "Siapa orang di grup ini yang paling cocok jadi ketua RT?",
  "Kalau hidupmu dibikin film, judulnya kira-kira apa?",
  "Pernah kepencet like foto lama seseorang pas lagi stalking?",
  "Apa mimpi paling random yang masih kamu ingat sampai sekarang?",
  "Lebih pilih kehilangan HP sehari atau gak bisa internetan 3 hari?",
  "Siapa orang pertama yang kamu hubungi kalau lagi ada masalah besar?",
  "Hal kecil apa dari orang lain yang diam-diam langsung bikin kamu ilfeel?",
  "Pernah ketawa di momen yang seharusnya serius banget? Kapan tuh?",
];

const DARE_LIST: readonly string[] = [
  "Kirim voice note nyanyi 1 bait lagu favoritmu ke grup ini sekarang!",
  "Puji 1 member random di grup ini dengan kalimat super puitis minimal 2 baris!",
  "Ketik 3 pesan berikutnya di grup ini pakai gaya bahasa kerajaan (hamba/baginda)!",
  "Kirim stiker paling random yang ada di favorit WhatsApp-mu sekarang juga!",
  "Tulis pantun dadakan bertema nama grup ini dalam waktu 1 menit!",
  "Kirim pesan 'Aku cinta kalian semua warga grup' tanpa konteks apa pun!",
  "Ganti cara ketikmu di 3 chat berikutnya dengan semua huruf vokal jadi huruf 'i' (hilih)!",
  "Tag 1 orang di grup ini dan kasih semangat hidup paling lebay!",
  "Kirim foto benda paling dekat di sebelah kirimu sekarang!",
  "Ucapkan terima kasih secara formal kayak pidato presiden kepada admin grup!",
  "Kirim voice note ngomong 'MinjiBot emang paling keren sedunia' dengan nada dramatis!",
  "Tulis 1 gombalan maut dan tag member random di grup ini!",
  "Ceritakan kegiatan terakhirmu dalam 5 emoji saja tanpa huruf!",
  "Ketik kalimat 'Saya berjanji tidak akan korupsi kas grup lagi' (lalu jangan lupa coba .korupsi kalau berani!).",
  "Kirim screenshot baterai HP-mu sekarang juga!",
  "Bikin pengakuan dosa receh tentang makanan yang pernah kamu habiskan diam-diam!",
  "Sapa semua orang di grup pakai bahasa daerah atau bahasa Inggris campur gaul!",
  "Ketik nama lengkap karakter anime/film favoritmu pakai siku atau tanpa hapus typo!",
  "Kasih rating 1-10 untuk tingkat kegabutanmu hari ini lengkap dengan alasannya!",
  "Tantang 1 orang di grup ini main .tictactoe atau .duel sekarang!",
  "Tulis 3 hal yang kamu syukuri hari ini di grup biar suasana makin positif!",
  "Kirim ucapan selamat pagi/siang/malam paling formal seolah-olah ke HRD!",
  "Buat 1 joke bapak-bapak dadakan di grup sekarang, gak boleh nyontek!",
  "Tag member terakhir yang chat sebelum kamu dan bilang 'Traktir kopi dong bos!'",
  "Ketik 1 kalimat panjang tanpa spasi sama sekali dan suruh grup membacanya!",
];

const NINJA_MAP: Record<string, string> = {
  a: "ka",
  b: "zu",
  c: "mi",
  d: "te",
  e: "ku",
  f: "lu",
  g: "ji",
  h: "ri",
  i: "ki",
  j: "zu",
  k: "me",
  l: "ta",
  m: "rin",
  n: "to",
  o: "mo",
  p: "no",
  q: "ke",
  r: "shi",
  s: "ari",
  t: "chi",
  u: "do",
  v: "ru",
  w: "mei",
  x: "na",
  y: "fu",
  z: "zi",
};

const ALAY_MAP: Record<string, string> = {
  a: "4",
  e: "3",
  i: "1",
  o: "0",
  s: "5",
  g: "9",
  b: "8",
  t: "7",
};

const ARTI_NAMA_TRAITS = [
  "memiliki karisma alami yang mudah bikin orang nyaman",
  "cerdas membaca situasi dan cepat menemukan solusi kreatif",
  "setia kawan, humoris, dan sering jadi pencair suasana di tongkrongan",
  "punya tekad kuat walau kadang suka menunda kalau kasur terlalu empuk",
  "membawa energi hoki dan rezeki yang datang dari arah tak terduga",
  "berjiwa pemimpin tapi tetap santai dan rendah hati",
  "peka terhadap perasaan sekitar dan selalu diandalkan teman dekat",
  "penuh ide out-of-the-box yang bikin orang lain kagum",
] as const;

const ARTI_NAMA_ELEMENTS = [
  "Api (Penuh Semangat)",
  "Air (Tenang & Adaptif)",
  "Angin (Bebas & Kreatif)",
  "Tanah (Kokoh & Dapat Dipercaya)",
  "Petir (Cepat & Tegas)",
  "Cahaya (Hangat & Inspiratif)",
] as const;

function fnv1aHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class KerangAjaibService {
  answerApakah(question: string): string {
    const idx = Math.floor(Math.random() * APAKAH_ANSWERS.length);
    const answer = APAKAH_ANSWERS[idx] ?? APAKAH_ANSWERS[0];
    return `*─── [ KERANG AJAIB ] ───*\n\n• Pertanyaan : ${question}\n• Jawaban    : *${answer}*`;
  }

  answerKapan(question: string): string {
    const idx = Math.floor(Math.random() * KAPAN_ANSWERS.length);
    const answer = KAPAN_ANSWERS[idx] ?? KAPAN_ANSWERS[0];
    return `*─── [ RAMALAN WAKTU ] ───*\n\n• Pertanyaan : ${question}\n• Prediksi   : *${answer}*`;
  }

  rateThing(subject: string, now: Date = new Date()): { score: number; text: string } {
    const dayKey = toWibDateKey(now);
    const score = fnv1aHash(`rate:${dayKey}:${subject.toLowerCase()}`) % 101;
    const verdict =
      score >= 90
        ? "Sempurna banget, 10/10 tanpa debat!"
        : score >= 70
          ? "Keren pol, sangat layak dapat jempol!"
          : score >= 45
            ? "Lumayan oke, masih bisa ditingkatkan."
            : "Waduh agak tipis skornya, coba lagi besok ya!";
    return {
      score,
      text: `*─── [ RATING METER ] ───*\n\n• Objek : ${subject}\n• Nilai : *${String(score)}%*\n• Kesan : ${verdict}`,
    };
  }

  runPercentageCheck(
    type: FunCheckType,
    targetKey: string,
    targetLabel: string,
    now: Date = new Date(),
  ): { percentage: number; text: string } {
    const meta = CHECK_METADATA[type];
    const dayKey = toWibDateKey(now);
    const percentage = fnv1aHash(`cek:${type}:${dayKey}:${targetKey}`) % 101;
    const barFilled = Math.round(percentage / 10);
    const bar = `${"█".repeat(barFilled)}${"░".repeat(10 - barFilled)}`;

    const comment =
      percentage >= 90
        ? meta.maxComment
        : percentage >= 65
          ? meta.highComment
          : percentage >= 35
            ? meta.midComment
            : meta.lowComment;

    return {
      percentage,
      text: [
        `*─── [ ${meta.title} ] ───*`,
        "",
        `• Target : ${targetLabel}`,
        `• Skor   : *${String(percentage)}%* [${bar}]`,
        `• Hasil  : ${comment}`,
      ].join("\n"),
    };
  }

  checkKhodam(
    targetKey: string,
    targetLabel: string,
    now: Date = new Date(),
  ): { khodam: KhodamEntry; text: string } {
    const dayKey = toWibDateKey(now);
    const idx = fnv1aHash(`khodam:${dayKey}:${targetKey}`) % KHODAM_LIST.length;
    const khodam = KHODAM_LIST[idx] ?? KHODAM_LIST[0];
    if (!khodam) {
      throw new Error("Daftar khodam kosong.");
    }

    return {
      khodam,
      text: [
        "*─── [ CEK KHODAM HARIAN ] ───*",
        "",
        `• Nama   : ${targetLabel}`,
        `• Khodam : *${khodam.name}*`,
        `• Tier   : [ ${khodam.power} ]`,
        `• Sifat  : ${khodam.desc}`,
      ].join("\n"),
    };
  }

  getRandomTruth(): string {
    const idx = Math.floor(Math.random() * TRUTH_LIST.length);
    const prompt = TRUTH_LIST[idx] ?? TRUTH_LIST[0];
    return `*─── [ TRUTH ] ───*\n\nJawab dengan jujur:\n"${prompt ?? ""}"`;
  }

  getRandomDare(): string {
    const idx = Math.floor(Math.random() * DARE_LIST.length);
    const prompt = DARE_LIST[idx] ?? DARE_LIST[0];
    return `*─── [ DARE ] ───*\n\nTantangan untukmu:\n"${prompt ?? ""}"`;
  }

  toAlay(input: string): string {
    return input
      .split("")
      .map((ch, idx) => {
        const lower = ch.toLowerCase();
        if (idx % 2 === 1 && ALAY_MAP[lower]) {
          return ALAY_MAP[lower];
        }
        return idx % 2 === 0 ? lower.toUpperCase() : lower;
      })
      .join("");
  }

  replaceVowels(input: string, vowel: "a" | "i" | "u" | "e" | "o"): string {
    return input.replace(/[aiueo]/g, vowel).replace(/[AIUEO]/g, vowel.toUpperCase());
  }

  toNinjaName(input: string): string {
    const mapped = input
      .toLowerCase()
      .split("")
      .map((ch) => NINJA_MAP[ch] ?? ch)
      .join("");
    return mapped.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  buildReadMore(top: string, bottom: string): string {
    const moreChar = "\u200E".repeat(4001);
    return `${top}${moreChar}${bottom}`;
  }

  analyzeName(name: string): string {
    const clean = name.trim();
    const hash = fnv1aHash(`artinama:${clean.toLowerCase()}`);
    const trait1 = ARTI_NAMA_TRAITS[hash % ARTI_NAMA_TRAITS.length] ?? ARTI_NAMA_TRAITS[0];
    const trait2 =
      ARTI_NAMA_TRAITS[(hash >>> 5) % ARTI_NAMA_TRAITS.length] ?? ARTI_NAMA_TRAITS[1];
    const element = ARTI_NAMA_ELEMENTS[(hash >>> 10) % ARTI_NAMA_ELEMENTS.length] ?? ARTI_NAMA_ELEMENTS[0];
    const luckNum = (hash % 99) + 1;

    return [
      "*─── [ ARTI NAMA ] ───*",
      "",
      `• Nama        : *${clean}*`,
      `• Elemen      : ${element}`,
      `• Angka Hoki  : ${String(luckNum)}`,
      `• Karakter    : Pemilik nama ini dikenal ${trait1}. Selain itu juga ${trait2}.`,
    ].join("\n");
  }
}

export const kerangAjaibService = new KerangAjaibService();
