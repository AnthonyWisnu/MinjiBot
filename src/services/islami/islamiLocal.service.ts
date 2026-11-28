import { randomInt } from "node:crypto";

import { AppUserError } from "../../errors/appUserError";

export interface DoaSpec {
  id: string;
  title: string;
  arabic: string;
  latin: string;
  meaning: string;
}

export interface NiatShalatSpec {
  id: string;
  title: string;
  rakaat: string;
  arabic: string;
  latin: string;
  meaning: string;
}

export interface DzikirItem {
  title: string;
  count: string;
  arabic: string;
  latin: string;
  meaning: string;
}

export interface HaditsSpec {
  number: number;
  topic: string;
  narrator: string;
  text: string;
}

export interface KisahNabiSpec {
  id: string;
  name: string;
  title: string;
  summary: string;
  lesson: string;
}

export interface HijriDateInfo {
  gregorianLabel: string;
  hijriLabel: string;
  hijriDay: string;
  hijriMonth: string;
  hijriYear: string;
  specialNote: string | null;
}

export const DOA_HARIAN_LIST: readonly DoaSpec[] = [
  {
    id: "tidur",
    title: "Doa Sebelum Tidur",
    arabic: "بِاسْمِكَ اللّٰهُمَّ اَحْيَا وَاَمُوْتُ",
    latin: "Bismika Allahumma ahyaa wa amuut.",
    meaning: "Dengan menyebut nama-Mu ya Allah, aku hidup dan aku mati.",
  },
  {
    id: "banguntidur",
    title: "Doa Bangun Tidur",
    arabic: "اَلْحَمْدُ لِلّٰهِ الَّذِيْ اَحْيَانَا بَعْدَ مَا اَمَاتَنَا وَاِلَيْهِ النُّشُوْرُ",
    latin: "Alhamdulillahil ladzii ahyaanaa ba'da maa amaatanaa wa ilaihin nusyuur.",
    meaning: "Segala puji bagi Allah yang telah menghidupkan kami setelah mematikan kami, dan kepada-Nya kami kembali.",
  },
  {
    id: "makan",
    title: "Doa Sebelum Makan",
    arabic: "اَللّٰهُمَّ بَارِكْ لَنَا فِيْمَا رَزَقْتَنَا وَقِنَا عَذَابَ النَّارِ",
    latin: "Allahumma baarik lanaa fiimaa razaqtanaa wa qinaa 'adzaaban naar.",
    meaning: "Ya Allah, berkahilah kami dalam rezeki yang Engkau berikan kepada kami dan peliharalah kami dari siksa api neraka.",
  },
  {
    id: "sesudahmakan",
    title: "Doa Sesudah Makan",
    arabic: "اَلْحَمْدُ لِلّٰهِ الَّذِيْ اَطْعَمَنَا وَسَقَانَا وَجَعَلَنَا مِنَ الْمُسْلِمِيْنَ",
    latin: "Alhamdulillahil ladzii ath'amanaa wa saqaanaa wa ja'alanaa minal muslimiin.",
    meaning: "Segala puji bagi Allah yang telah memberi kami makan dan minum serta menjadikan kami termasuk orang-orang muslim.",
  },
  {
    id: "keluarrumah",
    title: "Doa Keluar Rumah",
    arabic: "بِسْمِ اللّٰهِ تَوَكَّلْتُ عَلَى اللّٰهِ لَا حَوْلَ وَلَا قُوَّةَ اِلَّا بِاللّٰهِ",
    latin: "Bismillahi tawakkaltu 'alallah, laa haula wa laa quwwata illaa billaah.",
    meaning: "Dengan nama Allah aku bertawakal kepada Allah, tiada daya dan kekuatan kecuali dengan pertolongan Allah.",
  },
  {
    id: "masukrumah",
    title: "Doa Masuk Rumah",
    arabic: "بِسْمِ اللّٰهِ وَلَجْنَا وَبِسْمِ اللّٰهِ خَرَجْنَا وَعَلَى رَبِّنَا تَوَكَّلْنَا",
    latin: "Bismillahi walajnaa wa bismillahi kharajnaa wa 'alaa rabbinaa tawakkalnaa.",
    meaning: "Dengan nama Allah kami masuk, dengan nama Allah kami keluar, dan kepada Tuhan kami bertawakal.",
  },
  {
    id: "orangtua",
    title: "Doa untuk Kedua Orang Tua",
    arabic: "رَبِّ اغْفِرْ لِيْ وَلِوَالِدَيَّ وَارْحَمْهُمَا كَمَا رَبَّيَانِيْ صَغِيْرًا",
    latin: "Rabbighfir lii wa liwaalidayya warhamhumaa kamaa rabbayaanii shaghiiraa.",
    meaning: "Ya Tuhanku, ampunilah aku dan kedua orang tuaku, serta sayangilah keduanya sebagaimana mereka menyayangiku sejak kecil.",
  },
  {
    id: "belajar",
    title: "Doa Sebelum Belajar",
    arabic: "رَبِّ زِدْنِيْ عِلْمًا وَارْزُقْنِيْ فَهْمًا",
    latin: "Rabbi zidnii 'ilman warzuqnii fahman.",
    meaning: "Ya Tuhanku, tambahkanlah kepadaku ilmu dan berilah aku kefahaman.",
  },
  {
    id: "kendaraan",
    title: "Doa Naik Kendaraan",
    arabic: "سُبْحَانَ الَّذِيْ سَخَّرَ لَنَا هٰذَا وَمَا كُنَّا لَهُ مُقْرِنِيْنَ وَاِنَّا اِلٰى رَبِّنَا لَمُنْقَلِبُوْنَ",
    latin: "Subhaanal ladzii sakhkhara lanaa haadzaa wa maa kunnaa lahuu muqriniin, wa innaa ilaa rabbinaa lamunqalibuun.",
    meaning: "Maha Suci Allah yang telah menundukkan kendaraan ini bagi kami, padahal kami sebelumnya tidak mampu menguasainya, dan sesungguhnya kepada Tuhan kami pasti kembali.",
  },
  {
    id: "sapujagat",
    title: "Doa Sapu Jagat (Kebaikan Dunia Akhirat)",
    arabic: "رَبَّنَا اٰتِنَا فِي الدُّنْيَا حَسَنَةً وَّفِي الْاٰخِرَةِ حَسَنَةً وَّقِنَا عَذَابَ النَّارِ",
    latin: "Rabbanaa aatinaa fid dunyaa hasanatan wa fil aakhirati hasanatan wa qinaa 'adzaaban naar.",
    meaning: "Ya Tuhan kami, berilah kami kebaikan di dunia dan kebaikan di akhirat, serta lindungilah kami dari azab neraka.",
  },
  {
    id: "masukmasjid",
    title: "Doa Masuk Masjid",
    arabic: "اَللّٰهُمَّ افْتَحْ لِيْ اَبْوَابَ رَحْمَتِكَ",
    latin: "Allahummaf tahlii abwaaba rahmatik.",
    meaning: "Ya Allah, bukakanlah untukku pintu-pintu rahmat-Mu.",
  },
  {
    id: "keluarmasjid",
    title: "Doa Keluar Masjid",
    arabic: "اَللّٰهُمَّ اِنِّيْ اَسْاَلُكَ مِنْ فَضْلِكَ",
    latin: "Allahumma innii as-aluka min fadhlik.",
    meaning: "Ya Allah, sesungguhnya aku memohon sebagian dari karunia-Mu.",
  },
  {
    id: "hujan",
    title: "Doa Ketika Turun Hujan",
    arabic: "اَللّٰهُمَّ صَيِّبًا نَافِعًا",
    latin: "Allahumma shayyiban naafi'aa.",
    meaning: "Ya Allah, turunkanlah hujan yang bermanfaat.",
  },
  {
    id: "bercermin",
    title: "Doa Ketika Bercermin",
    arabic: "اَللّٰهُمَّ كَمَا حَسَّنْتَ خَلْقِيْ فَحَسِّنْ خُلُقِيْ",
    latin: "Allahumma kamaa hassanta khalqii fahassin khuluqii.",
    meaning: "Ya Allah, sebagaimana Engkau telah memperindah rupaku, maka perindahlah pula akhlakku.",
  },
  {
    id: "ketenangan",
    title: "Doa Kelapangan Hati",
    arabic: "رَبِّ اشْرَحْ لِيْ صَدْرِيْ وَيَسِّرْ لِيْ اَمْرِيْ",
    latin: "Rabbisyrah lii shadrii wa yassir lii amrii.",
    meaning: "Ya Tuhanku, lapangkanlah dadaku dan mudahkanlah urusanku.",
  },
];

export const NIAT_SHALAT_LIST: readonly NiatShalatSpec[] = [
  {
    id: "subuh",
    title: "Niat Shalat Subuh",
    rakaat: "2 Rakaat",
    arabic: "اُصَلِّيْ فَرْضَ الصُّبْحِ رَكْعَتَيْنِ مُسْتَقْبِلَ الْقِبْلَةِ اَدَاءً لِلّٰهِ تَعَالَى",
    latin: "Ushalli fardhash shubhi rak'ataini mustaqbilal qiblati adaa-an lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat fardhu Subuh dua rakaat menghadap kiblat tepat waktu karena Allah Ta'ala.",
  },
  {
    id: "dzuhur",
    title: "Niat Shalat Dzuhur",
    rakaat: "4 Rakaat",
    arabic: "اُصَلِّيْ فَرْضَ الظُّهْرِ اَرْبَعَ رَكَعَاتٍ مُسْتَقْبِلَ الْقِبْلَةِ اَدَاءً لِلّٰهِ تَعَالَى",
    latin: "Ushalli fardhazh zhuhri arba'a raka'aatin mustaqbilal qiblati adaa-an lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat fardhu Dzuhur empat rakaat menghadap kiblat tepat waktu karena Allah Ta'ala.",
  },
  {
    id: "ashar",
    title: "Niat Shalat Ashar",
    rakaat: "4 Rakaat",
    arabic: "اُصَلِّيْ فَرْضَ الْعَصْرِ اَرْبَعَ رَكَعَاتٍ مُسْتَقْبِلَ الْقِبْلَةِ اَدَاءً لِلّٰهِ تَعَالَى",
    latin: "Ushalli fardhal 'ashri arba'a raka'aatin mustaqbilal qiblati adaa-an lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat fardhu Ashar empat rakaat menghadap kiblat tepat waktu karena Allah Ta'ala.",
  },
  {
    id: "maghrib",
    title: "Niat Shalat Maghrib",
    rakaat: "3 Rakaat",
    arabic: "اُصَلِّيْ فَرْضَ الْمَغْرِبِ ثَلَاثَ رَكَعَاتٍ مُسْتَقْبِلَ الْقِبْلَةِ اَدَاءً لِلّٰهِ تَعَالَى",
    latin: "Ushalli fardhal maghribi tsalaatsa raka'aatin mustaqbilal qiblati adaa-an lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat fardhu Maghrib tiga rakaat menghadap kiblat tepat waktu karena Allah Ta'ala.",
  },
  {
    id: "isya",
    title: "Niat Shalat Isya",
    rakaat: "4 Rakaat",
    arabic: "اُصَلِّيْ فَرْضَ الْعِشَاءِ اَرْبَعَ رَكَعَاتٍ مُسْتَقْبِلَ الْقِبْلَةِ اَدَاءً لِلّٰهِ تَعَالَى",
    latin: "Ushalli fardhal 'isyaa-i arba'a raka'aatin mustaqbilal qiblati adaa-an lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat fardhu Isya empat rakaat menghadap kiblat tepat waktu karena Allah Ta'ala.",
  },
  {
    id: "jumat",
    title: "Niat Shalat Jumat (Makmum)",
    rakaat: "2 Rakaat",
    arabic: "اُصَلِّيْ فَرْضَ الْجُمُعَةِ رَكْعَتَيْنِ مُسْتَقْبِلَ الْقِبْلَةِ اَدَاءً مَاْمُوْمًا لِلّٰهِ تَعَالَى",
    latin: "Ushalli fardhal jumu'ati rak'ataini mustaqbilal qiblati adaa-an ma'muuman lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat fardhu Jumat dua rakaat menghadap kiblat sebagai makmum karena Allah Ta'ala.",
  },
  {
    id: "dhuha",
    title: "Niat Shalat Sunnah Dhuha",
    rakaat: "2 Rakaat",
    arabic: "اُصَلِّيْ سُنَّةَ الضُّحٰى رَكْعَتَيْنِ لِلّٰهِ تَعَالَى",
    latin: "Ushalli sunnatadh dhuhaa rak'ataini lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat sunnah Dhuha dua rakaat karena Allah Ta'ala.",
  },
  {
    id: "tahajud",
    title: "Niat Shalat Sunnah Tahajud",
    rakaat: "2 Rakaat",
    arabic: "اُصَلِّيْ سُنَّةَ التَّهَجُّدِ رَكْعَتَيْنِ لِلّٰهِ تَعَالَى",
    latin: "Ushalli sunnatat tahajjudi rak'ataini lillaahi ta'aalaa.",
    meaning: "Aku berniat shalat sunnah Tahajud dua rakaat karena Allah Ta'ala.",
  },
];

export const DZIKIR_LIST: readonly DzikirItem[] = [
  {
    title: "Istighfar",
    count: "3x / 100x",
    arabic: "اَسْتَغْفِرُ اللّٰهَ الْعَظِيْمَ",
    latin: "Astaghfirullahal 'azhiim.",
    meaning: "Aku memohon ampun kepada Allah Yang Maha Agung.",
  },
  {
    title: "Tasbih",
    count: "33x",
    arabic: "سُبْحَانَ اللّٰهِ",
    latin: "Subhaanallah.",
    meaning: "Maha Suci Allah.",
  },
  {
    title: "Tahmid",
    count: "33x",
    arabic: "اَلْحَمْدُ لِلّٰهِ",
    latin: "Alhamdulillah.",
    meaning: "Segala puji bagi Allah.",
  },
  {
    title: "Takbir",
    count: "33x",
    arabic: "اَللّٰهُ اَكْبَرُ",
    latin: "Allahu Akbar.",
    meaning: "Allah Maha Besar.",
  },
  {
    title: "Tahlil Penutup",
    count: "1x / 10x",
    arabic: "لَا اِلٰهَ اِلَّا اللّٰهُ وَحْدَهُ لَا شَرِيْكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلٰى كُلِّ شَيْءٍ قَدِيْرٌ",
    latin: "Laa ilaaha illallahu wahdahu laa syariika lah, lahul mulku wa lahul hamdu wa huwa 'alaa kulli syai-in qadiir.",
    meaning: "Tiada sesembahan yang berhak disembah selain Allah semata, tiada sekutu bagi-Nya. Milik-Nya kerajaan dan segala pujian, dan Dia Maha Kuasa atas segala sesuatu.",
  },
  {
    title: "Shalawat Nabi",
    count: "10x",
    arabic: "اَللّٰهُمَّ صَلِّ عَلٰى سَيِّدِنَا مُحَمَّدٍ وَعَلٰى اٰلِ سَيِّدِنَا مُحَمَّدٍ",
    latin: "Allahumma shalli 'alaa sayyidinaa Muhammad wa 'alaa aali sayyidinaa Muhammad.",
    meaning: "Ya Allah, limpahkanlah shalawat kepada Nabi Muhammad dan keluarga Nabi Muhammad.",
  },
];

export const HADITS_LIST: readonly HaditsSpec[] = [
  {
    number: 1,
    topic: "Niat",
    narrator: "HR. Bukhari & Muslim",
    text: "Sesungguhnya setiap amalan itu tergantung pada niatnya, dan setiap orang hanya akan mendapatkan sesuai dengan apa yang ia niatkan.",
  },
  {
    number: 2,
    topic: "Senyum adalah Sedekah",
    narrator: "HR. Tirmidzi",
    text: "Senyummu di hadapan saudaramu adalah sedekah bagimu.",
  },
  {
    number: 3,
    topic: "Berkata Baik atau Diam",
    narrator: "HR. Bukhari & Muslim",
    text: "Barang siapa yang beriman kepada Allah dan hari akhir, hendaklah ia berkata baik atau diam.",
  },
  {
    number: 4,
    topic: "Sebaik-baik Manusia",
    narrator: "HR. Ahmad & Ath-Thabrani",
    text: "Sebaik-baik manusia adalah yang paling bermanfaat bagi manusia lainnya.",
  },
  {
    number: 5,
    topic: "Menuntut Ilmu",
    narrator: "HR. Muslim",
    text: "Barang siapa menempuh suatu jalan untuk mencari ilmu, niscaya Allah akan memudahkan baginya jalan menuju surga.",
  },
  {
    number: 6,
    topic: "Menahan Amarah",
    narrator: "HR. Bukhari & Muslim",
    text: "Bukanlah orang kuat itu yang pandai bergulat, tetapi orang kuat adalah yang mampu mengendalikan dirinya ketika marah.",
  },
  {
    number: 7,
    topic: "Kebersihan",
    narrator: "HR. Muslim",
    text: "Kebersihan (bersuci) itu adalah sebagian dari iman.",
  },
  {
    number: 8,
    topic: "Keutamaan Jujur",
    narrator: "HR. Bukhari & Muslim",
    text: "Hendaklah kalian berlaku jujur, karena kejujuran membimbing kepada kebaikan, dan kebaikan membimbing ke surga.",
  },
  {
    number: 9,
    topic: "Memudahkan Urusan Orang Lain",
    narrator: "HR. Muslim",
    text: "Barang siapa memudahkan kesulitan orang yang sedang kesusahan, niscaya Allah akan memudahkan urusannya di dunia dan akhirat.",
  },
  {
    number: 10,
    topic: "Amalan Paling Dicintai",
    narrator: "HR. Bukhari & Muslim",
    text: "Amalan yang paling dicintai oleh Allah adalah amalan yang dilakukan secara rutin (istiqamah) meskipun sedikit.",
  },
  {
    number: 11,
    topic: "Silaturahmi",
    narrator: "HR. Bukhari & Muslim",
    text: "Barang siapa ingin dilapangkan rezekinya dan dipanjangkan umurnya, hendaklah ia menyambung tali silaturahmi.",
  },
  {
    number: 12,
    topic: "Kasih Sayang",
    narrator: "HR. Tirmidzi & Abu Dawud",
    text: "Orang-orang yang penyayang akan disayangi oleh Dzat Yang Maha Penyayang. Sayangilah penduduk bumi, niscaya yang di langit akan menyayangimu.",
  },
  {
    number: 13,
    topic: "Malu Sebagian dari Iman",
    narrator: "HR. Bukhari & Muslim",
    text: "Malu itu tidak mendatangkan sesuatu kecuali kebaikan.",
  },
  {
    number: 14,
    topic: "Sedekah Tidak Mengurangi Harta",
    narrator: "HR. Muslim",
    text: "Harta tidak akan berkurang karena sedekah, dan tidaklah seseorang memaafkan melainkan Allah akan menambah kemuliaannya.",
  },
  {
    number: 15,
    topic: "Menjauhi Hasad",
    narrator: "HR. Abu Dawud",
    text: "Jauhilah oleh kalian sifat hasad (dengki), karena sesungguhnya hasad itu memakan kebaikan sebagaimana api memakan kayu bakar.",
  },
];

export const KISAH_NABI_LIST: readonly KisahNabiSpec[] = [
  {
    id: "adam",
    name: "Nabi Adam AS",
    title: "Manusia Pertama dan Khalifah di Bumi",
    summary:
      "Nabi Adam AS diciptakan Allah SWT dari tanah dan diajarkan nama-nama segala sesuatu. Setelah sempat tergoda di surga dan diturunkan ke bumi bersama Hawa, beliau segera bertaubat dengan penuh penyesalan hingga Allah menerima taubatnya dan menjadikannya nenek moyang seluruh umat manusia.",
    lesson: "Segera mengakui kesalahan dan bertaubat dengan tulus ketika khilaf.",
  },
  {
    id: "nuh",
    name: "Nabi Nuh AS",
    title: "Keteguhan Dakwah 950 Tahun & Bahtera Besar",
    summary:
      "Nabi Nuh AS berdakwah selama ratusan tahun kepada kaumnya yang ingkar. Atas perintah Allah, beliau membangun bahtera raksasa di tengah ejekan kaumnya. Ketika banjir bah melanda, Allah menyelamatkan Nabi Nuh beserta orang-orang beriman dan sepasang dari tiap hewan di dalam bahtera.",
    lesson: "Tetap sabar dan teguh menjalankan kebenaran meski dicemooh banyak orang.",
  },
  {
    id: "ibrahim",
    name: "Nabi Ibrahim AS",
    title: "Khalilullah & Bapak Para Nabi",
    summary:
      "Nabi Ibrahim AS gigih mencari kebenaran dan menentang penyembahan berhala Raja Namrud. Ketika dilempar ke kobaran api besar, Allah menjadikan api itu dingin dan menyelamatkannya. Beliau juga diuji ketaatan agung bersama putranya Nabi Ismail AS hingga keduanya membangun kembali Ka'bah di Makkah.",
    lesson: "Keberanian membela tauhid dan keikhlasan total dalam menaati perintah Allah.",
  },
  {
    id: "yusuf",
    name: "Nabi Yusuf AS",
    title: "Kesabaran dari Sumur hingga Bendahara Mesir",
    summary:
      "Nabi Yusuf AS mengalami banyak ujian berat: dimasukkan ke sumur oleh saudara-saudaranya, dijual sebagai budak, dan dipenjara karena fitnah. Dengan kesabaran, ketakwaan, dan karunia menakwil mimpi, Allah mengangkat derajat beliau menjadi pemimpin ekonomi Mesir yang kelak memaafkan saudara-saudaranya.",
    lesson: "Kesabaran, menjaga kehormatan diri, dan berjiwa besar untuk memaafkan.",
  },
  {
    id: "ayyub",
    name: "Nabi Ayyub AS",
    title: "Teladan Kesabaran Tanpa Batas",
    summary:
      "Nabi Ayyub AS diuji kehilangan harta, anak-anak, dan menderita sakit kulit bertahun-tahun. Meski diuji demikian berat, lisan beliau tak pernah berhenti berdzikir dan bersyukur. Akhirnya Allah menyembuhkannya lewat mata air yang memancar dan mengembalikan nikmatnya berlipat ganda.",
    lesson: "Tetap bersyukur dan berprasangka baik kepada Allah di masa sempit maupun lapang.",
  },
  {
    id: "musa",
    name: "Nabi Musa AS",
    title: "Kalimullah & Pembebasan Bani Israil",
    summary:
      "Dibesarkan di istana Firaun sendiri, Nabi Musa AS diutus Allah bersama Nabi Harun AS untuk menyeru Firaun ke jalan kebenaran. Dengan mukjizat tongkat yang membelah Laut Merah, Allah menyelamatkan Nabi Musa dan pengikutnya serta menenggelamkan bala tentara Firaun yang sombong.",
    lesson: "Keberanian melawan kezaliman sambil selalu bergantung pada pertolongan Allah.",
  },
  {
    id: "sulaiman",
    name: "Nabi Sulaiman AS",
    title: "Raja Bijaksana yang Menguasai Bahasa Hewan",
    summary:
      "Nabi Sulaiman AS dianugerahi kerajaan yang sangat megah, kemampuan memahami bahasa burung dan semut, serta menundukkan angin. Meski memiliki kekuasaan luar biasa, beliau sangat rendah hati dan selalu mengembalikan semua nikmat sebagai karunia Allah SWT.",
    lesson: "Kekuasaan dan kekayaan sejati tidak membuat sombong, melainkan makin tunduk bersyukur.",
  },
  {
    id: "yunus",
    name: "Nabi Yunus AS",
    title: "Doa Dzun Nun dari Perut Ikan Paus",
    summary:
      "Nabi Yunus AS sempat meninggalkan kaumnya di Ninawa sebelum datang perintah Allah, lalu ditelan ikan paus besar di tengah lautan. Di dalam tiga kegelapan, beliau terus bertasbih mengakui kekhilafan hingga Allah menyelamatkannya ke daratan dan kaumnya akhirnya beriman.",
    lesson: "Tidak berputus asa dari rahmat Allah dan selalu beristighfar dalam kesulitan.",
  },
  {
    id: "isa",
    name: "Nabi Isa AS",
    title: "Lahir Tanpa Ayah & Mukjizat Penyembuhan",
    summary:
      "Nabi Isa AS lahir dari ibunda Maryam yang suci atas kuasa Allah SWT. Sejak bayi beliau berbicara membela ibunya, dan saat dewasa diberi mukjizat menyembuhkan orang sakit atas izin Allah sambil menyeru Bani Israil kepada tauhid dan kasih sayang.",
    lesson: "Kelembutan hati, kezuhudan, dan keyakinan penuh atas kekuasaan Allah.",
  },
  {
    id: "muhammad",
    name: "Nabi Muhammad SAW",
    title: "Khatamul Anbiya & Rahmat bagi Semesta Alam",
    summary:
      "Lahir di Makkah pada Tahun Gajah dan dikenal bergelar Al-Amin (yang terpercaya), Nabi Muhammad SAW menerima wahyu Al-Quran pada usia 40 tahun. Melalui kesabaran luar biasa di Makkah, hijrah ke Madinah, hingga Fathu Makkah tanpa dendam, beliau membawa ajaran Islam yang menyempurnakan akhlak mulia bagi seluruh umat manusia.",
    lesson: "Meneladani kejujuran, kasih sayang, akhlak mulia, dan keteguhan dakwah Rasulullah SAW.",
  },
];

export class IslamiLocalService {
  getDoa(query?: string): { mode: "list" | "single"; item?: DoaSpec; list?: readonly DoaSpec[] } {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) {
      return { mode: "single", item: DOA_HARIAN_LIST[randomInt(0, DOA_HARIAN_LIST.length)] };
    }
    if (q === "list" || q === "daftar") {
      return { mode: "list", list: DOA_HARIAN_LIST };
    }
    const found = DOA_HARIAN_LIST.find(
      (d) => d.id.includes(q) || d.title.toLowerCase().includes(q),
    );
    if (!found) {
      const keys = DOA_HARIAN_LIST.map((d) => d.id).join(", ");
      throw new AppUserError(`Doa "${query ?? ""}" tidak ditemukan.\nPilihan: ${keys}`);
    }
    return { mode: "single", item: found };
  }

  getNiatShalat(query?: string): {
    mode: "list" | "single";
    item?: NiatShalatSpec;
    list?: readonly NiatShalatSpec[];
  } {
    const q = (query ?? "").trim().toLowerCase();
    if (!q || q === "list" || q === "daftar") {
      return { mode: "list", list: NIAT_SHALAT_LIST };
    }
    const found = NIAT_SHALAT_LIST.find(
      (n) => n.id.includes(q) || n.title.toLowerCase().includes(q),
    );
    if (!found) {
      const keys = NIAT_SHALAT_LIST.map((n) => n.id).join(", ");
      throw new AppUserError(`Niat shalat "${query ?? ""}" tidak ditemukan.\nPilihan: ${keys}`);
    }
    return { mode: "single", item: found };
  }

  getDzikir(): readonly DzikirItem[] {
    return DZIKIR_LIST;
  }

  getHadits(rawNumber?: string): HaditsSpec {
    const trimmed = (rawNumber ?? "").trim();
    if (!trimmed) {
      const picked = HADITS_LIST[randomInt(0, HADITS_LIST.length)];
      if (picked) return picked;
      return {
        number: 1,
        topic: "Niat",
        narrator: "HR. Bukhari & Muslim",
        text: "Sesungguhnya setiap amalan itu tergantung pada niatnya.",
      };
    }
    const num = Number.parseInt(trimmed, 10);
    const byNum = HADITS_LIST.find((h) => h.number === num);
    if (byNum) return byNum;

    const lower = trimmed.toLowerCase();
    const byTopic = HADITS_LIST.find(
      (h) => h.topic.toLowerCase().includes(lower) || h.text.toLowerCase().includes(lower),
    );
    if (byTopic) return byTopic;

    throw new AppUserError(
      `Hadits "${trimmed}" tidak ditemukan. Gunakan nomor 1-${String(HADITS_LIST.length)} atau tanpa argumen untuk acak.`,
    );
  }

  getKisahNabi(query?: string): {
    mode: "list" | "single";
    item?: KisahNabiSpec;
    list?: readonly KisahNabiSpec[];
  } {
    const q = (query ?? "").trim().toLowerCase().replace(/^nabi\s+/, "");
    if (!q || q === "list" || q === "daftar") {
      return { mode: "list", list: KISAH_NABI_LIST };
    }
    const found = KISAH_NABI_LIST.find(
      (k) => k.id === q || k.id.includes(q) || k.name.toLowerCase().includes(q),
    );
    if (!found) {
      const keys = KISAH_NABI_LIST.map((k) => k.id).join(", ");
      throw new AppUserError(`Kisah nabi "${query ?? ""}" tidak ditemukan.\nPilihan: ${keys}`);
    }
    return { mode: "single", item: found };
  }

  getHijriDate(date: Date = new Date()): HijriDateInfo {
    const gregorianLabel = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);

    const hijriFormatter = new Intl.DateTimeFormat("id-ID-u-ca-islamic-umalqura", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const parts = hijriFormatter.formatToParts(date);
    const hijriDay = parts.find((p) => p.type === "day")?.value ?? "";
    const hijriMonth = parts.find((p) => p.type === "month")?.value ?? "";
    const hijriYear = parts.find((p) => p.type === "year")?.value ?? "";
    const hijriLabel = `${hijriDay} ${hijriMonth} ${hijriYear} H`.trim();

    const lowerMonth = hijriMonth.toLowerCase();
    let specialNote: string | null = null;
    if (lowerMonth.includes("ramad")) {
      specialNote = "Bulan Suci Ramadhan";
    } else if (lowerMonth.includes("syawal") && hijriDay === "1") {
      specialNote = "Hari Raya Idul Fitri 1 Syawal";
    } else if (lowerMonth.includes("zulhij") && hijriDay === "10") {
      specialNote = "Hari Raya Idul Adha 10 Dzulhijjah";
    } else if (lowerMonth.includes("muhar") && hijriDay === "1") {
      specialNote = "Tahun Baru Islam 1 Muharram";
    }

    return {
      gregorianLabel,
      hijriLabel,
      hijriDay,
      hijriMonth,
      hijriYear,
      specialNote,
    };
  }
}

export const islamiLocalService = new IslamiLocalService();
