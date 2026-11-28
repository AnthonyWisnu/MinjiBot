export type QuickQuizKind =
  | "susunkata"
  | "tebakbendera"
  | "siapakahaku"
  | "tebakkalimat"
  | "tebaklirik"
  | "tekateki"
  | "asahotak"
  | "tebakkimia"
  | "tebakibukota"
  | "tebakprovinsi"
  | "tebaklagu"
  | "benarsalah";

export interface QuickQuizQuestion {
  prompt: string;
  answers: string[];
  hint?: string;
}

export const QUICK_QUIZ_LABELS: Record<QuickQuizKind, string> = {
  susunkata: "SUSUN KATA",
  tebakbendera: "TEBAK BENDERA",
  siapakahaku: "SIAPAKAH AKU",
  tebakkalimat: "TEBAK KALIMAT",
  tebaklirik: "TEBAK LIRIK",
  tekateki: "TEKA-TEKI",
  asahotak: "ASAH OTAK",
  tebakkimia: "TEBAK UNSUR KIMIA",
  tebakibukota: "TEBAK IBU KOTA",
  tebakprovinsi: "TEBAK PROVINSI RI",
  tebaklagu: "TEBAK JUDUL LAGU",
  benarsalah: "BENAR ATAU SALAH",
};

const SUSUNKATA_WORDS: readonly { word: string; clue: string }[] = [
  { word: "KOMPUTER", clue: "Perangkat elektronik untuk mengolah data" },
  { word: "NUSANTARA", clue: "Sebutan kepulauan Indonesia" },
  { word: "MATAHARI", clue: "Bintang pusat tata surya" },
  { word: "PERPUSTAKAAN", clue: "Tempat menyimpan dan membaca buku" },
  { word: "TELEVISI", clue: "Media elektronik penayang gambar dan suara" },
  { word: "PESAWAT", clue: "Kendaraan transportasi udara" },
  { word: "INTERNET", clue: "Jaringan komunikasi global" },
  { word: "KERAJAAN", clue: "Bentuk pemerintahan dipimpin raja" },
  { word: "BENDERA", clue: "Kain lambang suatu negara" },
  { word: "SEKOLAH", clue: "Tempat belajar siswa" },
  { word: "MUSIKUS", clue: "Orang yang berkarya di bidang musik" },
  { word: "PELANGI", clue: "Lengkungan warna-warni setelah hujan" },
  { word: "SAHABAT", clue: "Teman yang sangat dekat" },
  { word: "RESTORAN", clue: "Tempat makan dan memesan hidangan" },
  { word: "OLAHRAGA", clue: "Aktivitas fisik menyehatkan tubuh" },
  { word: "SEJARAH", clue: "Ilmu tentang peristiwa masa lampau" },
  { word: "KEMERDEKAAN", clue: "Keadaan bebas dari penjajahan" },
  { word: "KENDARAAN", clue: "Alat transportasi darat, laut, atau udara" },
  { word: "TEKNOLOGI", clue: "Penerapan ilmu untuk memudahkan manusia" },
  { word: "GUNUNG", clue: "Permukaan bumi yang menjulang tinggi" },
  { word: "SAMUDRA", clue: "Lautan yang sangat luas" },
  { word: "MARTABAK", clue: "Jajanan malam manis atau telur" },
  { word: "RENDANG", clue: "Masakan daging khas Minangkabau" },
  { word: "ANGKLUNG", clue: "Alat musik bambu khas Jawa Barat" },
  { word: "WAYANG", clue: "Seni pertunjukan boneka tradisional" },
  { word: "BOROBUDUR", clue: "Candi Buddha terbesar di Indonesia" },
  { word: "KOMODO", clue: "Kadal purba raksasa dari NTT" },
  { word: "GARUDA", clue: "Burung lambang negara Indonesia" },
  { word: "ASTRONOT", clue: "Penjelajah luar angkasa" },
  { word: "UNIVERSITAS", clue: "Perguruan tinggi tempat mahasiswa kuliah" },
];

const KIMIA_ELEMENTS: readonly [string, string][] = [
  ["H", "Hidrogen"], ["He", "Helium"], ["Li", "Litium"], ["Be", "Berilium"], ["B", "Boron"],
  ["C", "Karbon"], ["N", "Nitrogen"], ["O", "Oksigen"], ["F", "Fluorin"], ["Ne", "Neon"],
  ["Na", "Natrium"], ["Mg", "Magnesium"], ["Al", "Aluminium"], ["Si", "Silikon"], ["P", "Fosfor"],
  ["S", "Belerang"], ["Cl", "Klorin"], ["Ar", "Argon"], ["K", "Kalium"], ["Ca", "Kalsium"],
  ["Ti", "Titanium"], ["Cr", "Kromium"], ["Mn", "Mangan"], ["Fe", "Besi"], ["Co", "Kobalt"],
  ["Ni", "Nikel"], ["Cu", "Tembaga"], ["Zn", "Seng"], ["As", "Arsenik"], ["Br", "Bromin"],
  ["Kr", "Kripton"], ["Ag", "Perak"], ["Sn", "Timah"], ["I", "Iodin"], ["Xe", "Xenon"],
  ["Cs", "Sesium"], ["Ba", "Barium"], ["W", "Tungsten"], ["Pt", "Platina"], ["Au", "Emas"],
  ["Hg", "Raksa"], ["Pb", "Timbal"], ["Rn", "Radon"], ["Ra", "Radium"], ["U", "Uranium"],
];

const PROVINSI_RI: readonly [string, string[]][] = [
  ["Aceh", ["Banda Aceh"]],
  ["Sumatera Utara", ["Medan"]],
  ["Sumatera Barat", ["Padang"]],
  ["Riau", ["Pekanbaru"]],
  ["Kepulauan Riau", ["Tanjungpinang", "Tanjung Pinang"]],
  ["Jambi", ["Jambi"]],
  ["Sumatera Selatan", ["Palembang"]],
  ["Bengkulu", ["Bengkulu"]],
  ["Lampung", ["Bandar Lampung", "Bandarlampung"]],
  ["Bangka Belitung", ["Pangkalpinang", "Pangkal Pinang"]],
  ["Banten", ["Serang"]],
  ["Jawa Barat", ["Bandung"]],
  ["Jawa Tengah", ["Semarang"]],
  ["DI Yogyakarta", ["Yogyakarta", "Jogja"]],
  ["Jawa Timur", ["Surabaya"]],
  ["Bali", ["Denpasar"]],
  ["Nusa Tenggara Barat", ["Mataram"]],
  ["Nusa Tenggara Timur", ["Kupang"]],
  ["Kalimantan Barat", ["Pontianak"]],
  ["Kalimantan Tengah", ["Palangka Raya", "Palangkaraya"]],
  ["Kalimantan Selatan", ["Banjarbaru", "Banjarmasin"]],
  ["Kalimantan Timur", ["Samarinda"]],
  ["Kalimantan Utara", ["Tanjung Selor"]],
  ["Sulawesi Utara", ["Manado"]],
  ["Sulawesi Tengah", ["Palu"]],
  ["Sulawesi Selatan", ["Makassar"]],
  ["Sulawesi Tenggara", ["Kendari"]],
  ["Gorontalo", ["Gorontalo"]],
  ["Sulawesi Barat", ["Mamuju"]],
  ["Maluku", ["Ambon"]],
  ["Maluku Utara", ["Sofifi"]],
  ["Papua", ["Jayapura"]],
  ["Papua Barat", ["Manokwari"]],
  ["Papua Barat Daya", ["Sorong"]],
  ["Papua Tengah", ["Nabire"]],
  ["Papua Pegunungan", ["Wamena", "Jayawijaya"]],
  ["Papua Selatan", ["Merauke"]],
];

const WORLD_CAPITALS: readonly [string, string[]][] = [
  ["Jepang", ["Tokyo"]],
  ["Korea Selatan", ["Seoul"]],
  ["Thailand", ["Bangkok"]],
  ["Vietnam", ["Hanoi"]],
  ["Malaysia", ["Kuala Lumpur"]],
  ["Filipina", ["Manila"]],
  ["Australia", ["Canberra"]],
  ["Selandia Baru", ["Wellington"]],
  ["Inggris", ["London"]],
  ["Prancis", ["Paris"]],
  ["Jerman", ["Berlin"]],
  ["Italia", ["Roma", "Rome"]],
  ["Spanyol", ["Madrid"]],
  ["Belanda", ["Amsterdam"]],
  ["Rusia", ["Moskow", "Moscow"]],
  ["Turki", ["Ankara"]],
  ["Mesir", ["Kairo", "Cairo"]],
  ["Arab Saudi", ["Riyadh"]],
  ["India", ["New Delhi"]],
  ["Tiongkok", ["Beijing"]],
  ["Amerika Serikat", ["Washington", "Washington DC"]],
  ["Kanada", ["Ottawa"]],
  ["Brasil", ["Brasilia"]],
  ["Argentina", ["Buenos Aires"]],
  ["Meksiko", ["Mexico City"]],
  ["Swiss", ["Bern"]],
  ["Swedia", ["Stockholm"]],
  ["Norwegia", ["Oslo"]],
  ["Portugal", ["Lisbon", "Lisboa"]],
  ["Yunani", ["Athena", "Athens"]],
];

const FLAG_QUESTIONS: readonly QuickQuizQuestion[] = [
  { prompt: "🇮🇩 Bendera negara manakah ini?", answers: ["Indonesia"] },
  { prompt: "🇯🇵 Bendera negara manakah ini?", answers: ["Jepang", "Japan"] },
  { prompt: "🇰🇷 Bendera negara manakah ini?", answers: ["Korea Selatan", "South Korea"] },
  { prompt: "🇧🇷 Bendera negara manakah ini?", answers: ["Brasil", "Brazil"] },
  { prompt: "🇫🇷 Bendera negara manakah ini?", answers: ["Prancis", "Perancis", "France"] },
  { prompt: "🇩🇪 Bendera negara manakah ini?", answers: ["Jerman", "Germany"] },
  { prompt: "🇮🇹 Bendera negara manakah ini?", answers: ["Italia", "Italy"] },
  { prompt: "🇪🇸 Bendera negara manakah ini?", answers: ["Spanyol", "Spain"] },
  { prompt: "🇬🇧 Bendera negara manakah ini?", answers: ["Inggris", "Britania Raya", "UK"] },
  { prompt: "🇺🇸 Bendera negara manakah ini?", answers: ["Amerika Serikat", "Amerika", "USA"] },
  { prompt: "🇨🇦 Bendera negara manakah ini?", answers: ["Kanada", "Canada"] },
  { prompt: "🇦🇺 Bendera negara manakah ini?", answers: ["Australia"] },
  { prompt: "🇸🇦 Bendera negara manakah ini?", answers: ["Arab Saudi", "Saudi Arabia"] },
  { prompt: "🇹🇷 Bendera negara manakah ini?", answers: ["Turki", "Turkey"] },
  { prompt: "🇪🇬 Bendera negara manakah ini?", answers: ["Mesir", "Egypt"] },
  { prompt: "🇹🇭 Bendera negara manakah ini?", answers: ["Thailand"] },
  { prompt: "🇻🇳 Bendera negara manakah ini?", answers: ["Vietnam"] },
  { prompt: "🇲🇾 Bendera negara manakah ini?", answers: ["Malaysia"] },
  { prompt: "🇸🇬 Bendera negara manakah ini?", answers: ["Singapura", "Singapore"] },
  { prompt: "🇵🇭 Bendera negara manakah ini?", answers: ["Filipina", "Philippines"] },
  { prompt: "🇦🇷 Bendera negara manakah ini?", answers: ["Argentina"] },
  { prompt: "🇵🇹 Bendera negara manakah ini?", answers: ["Portugal"] },
  { prompt: "🇳🇱 Bendera negara manakah ini?", answers: ["Belanda", "Netherlands"] },
  { prompt: "🇨🇭 Bendera negara manakah ini?", answers: ["Swiss", "Switzerland"] },
  { prompt: "🇲🇽 Bendera negara manakah ini?", answers: ["Meksiko", "Mexico"] },
];

const SIAPAKAH_AKU: readonly QuickQuizQuestion[] = [
  { prompt: "Aku punya jarum tapi tidak bisa menjahit, punya angka tapi tidak bisa berhitung. Siapakah aku?", answers: ["Jam", "Jam dinding"] },
  { prompt: "Aku selalu datang tapi tidak pernah tiba hari ini. Siapakah aku?", answers: ["Besok", "Hari esok"] },
  { prompt: "Semakin banyak aku diambil, semakin besar ukuranku. Siapakah aku?", answers: ["Lubang"] },
  { prompt: "Aku punya kota tapi tidak punya rumah, punya gunung tapi tidak punya pohon, punya air tapi tidak punya ikan. Siapakah aku?", answers: ["Peta"] },
  { prompt: "Aku hanya bisa dipakai setelah dipecahkan. Siapakah aku?", answers: ["Telur"] },
  { prompt: "Aku punya leher tapi tidak punya kepala, punya dua lengan tapi tidak punya tangan. Siapakah aku?", answers: ["Baju", "Kemeja"] },
  { prompt: "Aku basah saat sedang mengeringkan sesuatu. Siapakah aku?", answers: ["Handuk"] },
  { prompt: "Aku penuh lubang tapi masih bisa menahan air. Siapakah aku?", answers: ["Spons", "Spon"] },
  { prompt: "Aku punya gigi yang sangat banyak tapi tidak bisa menggigit. Siapakah aku?", answers: ["Sisir", "Gergaji"] },
  { prompt: "Aku naik saat hujan turun. Siapakah aku?", answers: ["Payung"] },
  { prompt: "Aku berwarna hitam saat dibeli, merah saat dipakai, dan abu-abu saat dibuang. Siapakah aku?", answers: ["Arang"] },
  { prompt: "Aku milikmu sendiri, tapi orang lain jauh lebih sering memakainya daripada kamu. Siapakah aku?", answers: ["Nama"] },
  { prompt: "Aku punya kunci tapi tidak bisa membuka pintu apa pun. Siapakah aku?", answers: ["Piano", "Keyboard"] },
  { prompt: "Aku berjalan tanpa kaki, menangis tanpa mata. Siapakah aku?", answers: ["Awan"] },
  { prompt: "Tinggi saat muda dan pendek saat tua. Siapakah aku?", answers: ["Lilin"] },
];

const TEBAK_KALIMAT: readonly QuickQuizQuestion[] = [
  { prompt: "Lengkapi peribahasa: Bagai air di daun ____", answers: ["Talas"] },
  { prompt: "Lengkapi peribahasa: Berakit-rakit ke hulu, berenang-renang ke ____", answers: ["Tepian"] },
  { prompt: "Lengkapi peribahasa: Tong kosong nyaring ____", answers: ["Bunyinya"] },
  { prompt: "Lengkapi peribahasa: Besar pasak daripada ____", answers: ["Tiang"] },
  { prompt: "Lengkapi peribahasa: Ada udang di balik ____", answers: ["Batu"] },
  { prompt: "Lengkapi peribahasa: Tak ada rotan ____ pun jadi", answers: ["Akar"] },
  { prompt: "Lengkapi peribahasa: Air beriak tanda tak ____", answers: ["Dalam"] },
  { prompt: "Lengkapi peribahasa: Berat sama dipikul, ringan sama ____", answers: ["Dijinjing"] },
  { prompt: "Lengkapi peribahasa: Sambil menyelam minum ____", answers: ["Air"] },
  { prompt: "Lengkapi peribahasa: Sudah jatuh tertimpa ____", answers: ["Tangga"] },
  { prompt: "Lengkapi peribahasa: Bagai pinang dibelah ____", answers: ["Dua"] },
  { prompt: "Lengkapi peribahasa: Sepandai-pandainya tupai melompat, sekali waktu ____ juga", answers: ["Jatuh"] },
  { prompt: "Lengkapi peribahasa: Nila setitik rusak ____ sebelanga", answers: ["Susu"] },
  { prompt: "Lengkapi peribahasa: Sedikit demi sedikit lama-lama menjadi ____", answers: ["Bukit"] },
  { prompt: "Lengkapi peribahasa: Di mana bumi dipijak, di situ langit ____", answers: ["Dijunjung"] },
];

const TEBAK_LIRIK: readonly QuickQuizQuestion[] = [
  { prompt: "Lanjutkan lirik: 'Mimpi adalah kunci, untuk kita menaklukkan ____'", answers: ["Dunia"] },
  { prompt: "Lanjutkan lirik: 'Suara dengarkanlah aku, apa kabarnya pujaan ____'", answers: ["Hatiku"] },
  { prompt: "Lanjutkan lirik: 'Separuh aku dirimu, berada di ____'", answers: ["Dalamku", "Diriku"] },
  { prompt: "Lanjutkan lirik: 'Dan bila esok datang kembali, seperti sedia kala di mana kau bisa ____'", answers: ["Bercanda"] },
  { prompt: "Lanjutkan lirik: 'Karena kamu cuma satu, untukku selama-____'", answers: ["Lamanya"] },
  { prompt: "Lanjutkan lirik: 'Bintang di surga, masih kuingat selalu ____'", answers: ["Senyummu", "Kenangan"] },
  { prompt: "Lanjutkan lirik: 'Terlalu manis untuk dilupakan, kenangan yang ____'", answers: ["Indah"] },
  { prompt: "Lanjutkan lirik: 'Selamat ulang tahun, kami ucapkan, selamat panjang ____'", answers: ["Umur"] },
  { prompt: "Lanjutkan lirik: 'Indonesia tanah air beta, pusaka abadi nan ____'", answers: ["Jaya"] },
  { prompt: "Lanjutkan lirik: 'Gugur satu tumbuh ____'", answers: ["Seribu"] },
  { prompt: "Lanjutkan lirik: 'Hati-hati di jalan, semoga kau ____'", answers: ["Bahagia", "Selamat"] },
  { prompt: "Lanjutkan lirik: 'Kangen... semua kata rindumu semakin membuatku tak ____'", answers: ["Berdaya"] },
];

const TEBAK_LAGU: readonly QuickQuizQuestion[] = [
  { prompt: "Judul lagu dari lirik: 'Mimpi adalah kunci untuk kita menaklukkan dunia' (Nidji)?", answers: ["Laskar Pelangi"] },
  { prompt: "Judul lagu dari lirik: 'Kini ku harus pergi meninggalkan kamu yang telah hancurkan aku' (NOAH)?", answers: ["Separuh Aku"] },
  { prompt: "Judul lagu dari lirik: 'Kukira kita akan bersama, begitu banyak yang sama' (Tulus)?", answers: ["Hati-Hati di Jalan", "Hati Hati di Jalan"] },
  { prompt: "Judul lagu dari lirik: 'Semua kata rindumu semakin membuatku tak berdaya' (Dewa 19)?", answers: ["Kangen"] },
  { prompt: "Judul lagu dari lirik: 'Dan... lupakanlah saja diriku bila itu bisa membuatmu kembali bersinar' (Sheila On 7)?", answers: ["Dan"] },
  { prompt: "Judul lagu dari lirik: 'Ku menangis membayangkan betapa kejamnya dirimu atas diriku' (Rossa)?", answers: ["Hati yang Kau Sakiti"] },
  { prompt: "Judul lagu dari lirik: 'Tak selamanya mendung itu kelabu, nyatanya hari ini kulihat senyummu' (Tulus)?", answers: ["Monokrom", "Cahaya"] },
  { prompt: "Judul lagu dari lirik: 'Bawa dia kembali tuhan, bawa dia kembali' (Mahalini)?", answers: ["Sial", "Sisa Rasa"] },
  { prompt: "Judul lagu dari lirik: 'Jangan menyerah, jangan menyerah, jangan menyerah' (D'Masiv)?", answers: ["Jangan Menyerah"] },
  { prompt: "Judul lagu dari lirik: 'Pegang tanganku bersama jatuh cinta, kali kedua pada yang sama' (Raisa)?", answers: ["Kali Kedua"] },
  { prompt: "Judul lagu dari lirik: 'Bertaut... bun, hidup berjalan seperti bajingan' (Nadin Amizah)?", answers: ["Bertaut"] },
  { prompt: "Judul lagu dari lirik: 'Kau hancurkan aku dengan sikapmu, tak sadarkah kau telah menyakitiku' (Armada)?", answers: ["Asal Kau Bahagia", "Hargai Aku"] },
];

const TEKA_TEKI: readonly QuickQuizQuestion[] = [
  { prompt: "Ada 5 burung di atas pohon. Satu ditembak jatuh. Berapa sisa burung di atas pohon?", answers: ["0", "Nol", "Kosong"], hint: "Yang lain kaget lalu terbang!" },
  { prompt: "Bulan apa yang punya 28 hari?", answers: ["Semua bulan", "Semua", "12 bulan"], hint: "Bukan cuma Februari lho!" },
  { prompt: "Ayah Budi punya 3 anak: Ani, Ina, dan siapa anak ketiganya?", answers: ["Budi"] },
  { prompt: "Mana yang lebih berat: 1 kg kapas atau 1 kg besi?", answers: ["Sama", "Sama berat"] },
  { prompt: "Apa yang selalu ada di tengah-tengah 'Jakarta'?", answers: ["A", "Huruf A", "R"] },
  { prompt: "Kalau kamu menyalip orang di posisi ke-2 dalam lomba lari, sekarang kamu di posisi ke berapa?", answers: ["2", "Kedua", "Ke 2"] },
  { prompt: "Pintu apa yang didorong 10 orang pun tetap tidak bisa terbuka?", answers: ["Pintu tarik", "Pintu bertuliskan tarik"] },
  { prompt: "Hewan apa yang paling pendiam?", answers: ["Semut", "Se-mute"] },
  { prompt: "Kopi apa yang bisa menggigit?", answers: ["Kopi-ting", "Kepiting"] },
  { prompt: "Buah apa yang selalu membawa barang?", answers: ["Salak", "Sa-lak", "Anggur", "Jambu"] },
  { prompt: "Ikan apa yang paling sering berhenti?", answers: ["Ikan paus", "Paus"] },
  { prompt: "Ayam apa yang paling besar?", answers: ["Ayam semesta", "Alam semesta"] },
];

const ASAH_OTAK: readonly QuickQuizQuestion[] = [
  { prompt: "Planet manakah yang paling dekat dengan Matahari?", answers: ["Merkurius", "Mercury"] },
  { prompt: "Berapa jumlah sisi pada sebuah kubus?", answers: ["6", "Enam"] },
  { prompt: "Sungai terpanjang di Indonesia adalah sungai?", answers: ["Kapuas", "Sungai Kapuas"] },
  { prompt: "Siapa penemu lampu pijar yang terkenal?", answers: ["Thomas Edison", "Thomas Alva Edison", "Edison"] },
  { prompt: "Organ tubuh manusia yang bertugas memompa darah adalah?", answers: ["Jantung"] },
  { prompt: "Gas terbesar penyusun atmosfer Bumi (sekitar 78%) adalah?", answers: ["Nitrogen"] },
  { prompt: "Mata uang resmi negara Jepang adalah?", answers: ["Yen"] },
  { prompt: "Hewan darat tercepat di dunia adalah?", answers: ["Cheetah", "Citah"] },
  { prompt: "Gunung tertinggi di dunia adalah Gunung?", answers: ["Everest", "Mount Everest"] },
  { prompt: "Proklamasi Kemerdekaan Indonesia dibacakan pada tanggal 17 Agustus tahun?", answers: ["1945"] },
  { prompt: "Berapakah hasil dari 12 x 12?", answers: ["144"] },
  { prompt: "Benua terkecil di dunia adalah?", answers: ["Australia"] },
  { prompt: "Alat untuk mengukur gempa bumi disebut?", answers: ["Seismograf", "Seismometer"] },
  { prompt: "Vitamin yang banyak terdapat pada buah jeruk adalah vitamin?", answers: ["C", "Vitamin C"] },
  { prompt: "Candi Hindu terbesar di Indonesia adalah Candi?", answers: ["Prambanan"] },
];

const BENAR_SALAH: readonly QuickQuizQuestion[] = [
  { prompt: "Benar atau Salah: Lumba-lumba adalah ikan.", answers: ["Salah", "S", "False"], hint: "Lumba-lumba adalah mamalia!" },
  { prompt: "Benar atau Salah: Gunung Everest berada di Pegunungan Himalaya.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Matahari terbit dari arah barat.", answers: ["Salah", "S", "False"] },
  { prompt: "Benar atau Salah: Air mendidih pada suhu 100 derajat Celcius di tekanan 1 atm.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Gurita memiliki 3 jantung.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Ibu kota Australia adalah Sydney.", answers: ["Salah", "S", "False"], hint: "Ibu kotanya Canberra!" },
  { prompt: "Benar atau Salah: Indonesia memiliki lebih dari 17.000 pulau.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Kelelawar adalah satu-satunya mamalia yang bisa terbang aktif.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Bulan memancarkan cahayanya sendiri.", answers: ["Salah", "S", "False"] },
  { prompt: "Benar atau Salah: Bahasa pemrograman JavaScript dan Java adalah bahasa yang sama.", answers: ["Salah", "S", "False"] },
  { prompt: "Benar atau Salah: Saturnus adalah planet yang memiliki cincin paling mencolok.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Paus biru adalah hewan terbesar yang pernah hidup di Bumi.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Candi Borobudur terletak di Provinsi Jawa Timur.", answers: ["Salah", "S", "False"], hint: "Terletak di Magelang, Jawa Tengah!" },
  { prompt: "Benar atau Salah: H2O adalah rumus kimia untuk air.", answers: ["Benar", "B", "True"] },
  { prompt: "Benar atau Salah: Tahun kabisat terjadi setiap 4 tahun sekali (dengan pengecualian abad).", answers: ["Benar", "B", "True"] },
];

function scrambleWord(word: string): string {
  const letters = word.split("");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (let i = letters.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = letters[i];
      const swp = letters[j];
      if (tmp !== undefined && swp !== undefined) {
        letters[i] = swp;
        letters[j] = tmp;
      }
    }
    const res = letters.join("");
    if (res !== word) return res.split("").join(" - ");
  }
  return letters.reverse().join(" - ");
}

export function drawQuickQuizQuestion(kind: QuickQuizKind): QuickQuizQuestion {
  const pick = <T>(arr: readonly T[]): T => {
    const idx = Math.floor(Math.random() * arr.length);
    return arr[idx] ?? (arr[0] as T);
  };

  if (kind === "susunkata") {
    const item = pick(SUSUNKATA_WORDS);
    return {
      prompt: `Susun huruf acak berikut menjadi kata yang benar:\n*${scrambleWord(item.word)}*\nPetunjuk: _${item.clue}_`,
      answers: [item.word],
      hint: item.clue,
    };
  }

  if (kind === "tebakkimia") {
    const [symbol, name] = pick(KIMIA_ELEMENTS);
    return {
      prompt: `Apa nama unsur kimia dengan lambang *${symbol}*?`,
      answers: [name],
    };
  }

  if (kind === "tebakprovinsi") {
    const [prov, capitals] = pick(PROVINSI_RI);
    return {
      prompt: `Apa ibu kota dari Provinsi *${prov}*?`,
      answers: capitals,
    };
  }

  if (kind === "tebakibukota") {
    const [country, capitals] = pick(WORLD_CAPITALS);
    return {
      prompt: `Apa ibu kota dari negara *${country}*?`,
      answers: capitals,
    };
  }

  const map: Record<
    Exclude<QuickQuizKind, "susunkata" | "tebakkimia" | "tebakprovinsi" | "tebakibukota">,
    readonly QuickQuizQuestion[]
  > = {
    tebakbendera: FLAG_QUESTIONS,
    siapakahaku: SIAPAKAH_AKU,
    tebakkalimat: TEBAK_KALIMAT,
    tebaklirik: TEBAK_LIRIK,
    tekateki: TEKA_TEKI,
    asahotak: ASAH_OTAK,
    tebaklagu: TEBAK_LAGU,
    benarsalah: BENAR_SALAH,
  };

  return pick(map[kind]);
}
