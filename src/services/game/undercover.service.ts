import { AppUserError } from "../../errors/appUserError";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId, MemberEconomyService } from "../member/memberEconomy.service";

export type UndercoverRole = "warga" | "undercover";
export type UndercoverPhase = "lobby" | "voting";

export interface UndercoverPlayer {
  slot: number;
  userJid: string;
  role: UndercoverRole;
  word: string;
  alive: boolean;
}

export interface UndercoverSession {
  groupJid: string;
  hostJid: string;
  phase: UndercoverPhase;
  roundNumber: number;
  citizenWord: string;
  undercoverWord: string;
  players: UndercoverPlayer[];
  votes: Map<number, number>;
  createdAt: number;
  expiresAt: number;
}

export interface UndercoverWinnerSummary {
  winningTeam: UndercoverRole;
  winners: UndercoverPlayer[];
  rewardMoneyBase: bigint;
  rewardXp: number;
  rewardPoints: number;
}

export interface UndercoverVoteResolution {
  eliminatedPlayer: UndercoverPlayer | null;
  wasTie: boolean;
  winner: UndercoverWinnerSummary | null;
  session: UndercoverSession;
}

export const UNDERCOVER_MIN_PLAYERS = 4;
export const UNDERCOVER_MAX_PLAYERS = 10;
export const UNDERCOVER_TTL_MS = 15 * 60 * 1000;
export const UNDERCOVER_WARGA_REWARD = 20_000_000n;
export const UNDERCOVER_SPY_REWARD = 30_000_000n;
const MAX_UNDERCOVER_ROOMS = 50;

const WORD_PAIRS: readonly [string, string][] = [
  ["Kopi", "Teh"],
  ["Indomie", "Mie Sedaap"],
  ["Gojek", "Grab"],
  ["Kucing", "Harimau"],
  ["Bakso", "Cilok"],
  ["Android", "iPhone"],
  ["Nasi Goreng", "Mie Goreng"],
  ["Pantai", "Kolam Renang"],
  ["Sepeda", "Motor"],
  ["Bantal", "Guling"],
  ["WhatsApp", "Telegram"],
  ["YouTube", "TikTok"],
  ["Sate", "Rendang"],
  ["Hujan", "Gerimis"],
  ["Matahari", "Bulan"],
  ["Kemeja", "Kaos"],
  ["Sepatu", "Sandal"],
  ["Dokter", "Perawat"],
  ["Sekolah", "Kampus"],
  ["Bioskop", "Teater"],
  ["Pizza", "Burger"],
  ["Es Krim", "Yogurt"],
  ["Gitar", "Ukulele"],
  ["Anjing", "Serigala"],
  ["Buku", "Majalah"],
  ["Pensil", "Pulpen"],
  ["Bola Basket", "Bola Voli"],
  ["Kereta Api", "Bus"],
  ["Laptop", "Tablet"],
  ["Cokelat", "Keju"],
];

interface UndercoverEconomy {
  creditMoney(input: {
    groupJid: string;
    userJid: string;
    amount: bigint;
    type: "GAME_REWARD";
    scaleByLevel?: boolean;
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
  creditPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
  creditXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
}

export class UndercoverService {
  private readonly sessions = new Map<string, UndercoverSession>();

  constructor(
    private readonly economy: UndercoverEconomy = new MemberEconomyService(),
    private readonly shuffleFn: <T>(arr: T[]) => T[] = shuffleArray,
  ) {}

  getSession(groupJid: string, nowMs = Date.now()): UndercoverSession | null {
    this.sweepExpired(nowMs);
    return this.sessions.get(groupJid) ?? null;
  }

  createLobby(groupJid: string, hostJid: string, nowMs = Date.now()): UndercoverSession {
    this.sweepExpired(nowMs);
    if (this.sessions.has(groupJid)) {
      throw new AppUserError("Sudah ada sesi Undercover aktif di grup ini! Ketik *.uc join*.");
    }
    if (this.sessions.size >= MAX_UNDERCOVER_ROOMS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }

    const normHost = normalizeUserJid(hostJid);
    const session: UndercoverSession = {
      groupJid,
      hostJid: normHost,
      phase: "lobby",
      roundNumber: 0,
      citizenWord: "",
      undercoverWord: "",
      players: [{ slot: 1, userJid: normHost, role: "warga", word: "", alive: true }],
      votes: new Map(),
      createdAt: nowMs,
      expiresAt: nowMs + UNDERCOVER_TTL_MS,
    };
    this.sessions.set(groupJid, session);
    return session;
  }

  joinLobby(groupJid: string, userJid: string, nowMs = Date.now()): UndercoverSession {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada lobby Undercover. Ketik *.uc buat* untuk membuka!");
    }
    if (session.phase !== "lobby") {
      throw new AppUserError("Permainan Undercover sudah dimulai.");
    }

    const normUser = normalizeUserJid(userJid);
    if (session.players.some((p) => p.userJid === normUser)) {
      throw new AppUserError("Kamu sudah terdaftar di lobby Undercover.");
    }
    if (session.players.length >= UNDERCOVER_MAX_PLAYERS) {
      throw new AppUserError(`Lobby Undercover penuh (${String(UNDERCOVER_MAX_PLAYERS)} pemain).`);
    }

    session.players.push({
      slot: session.players.length + 1,
      userJid: normUser,
      role: "warga",
      word: "",
      alive: true,
    });
    return session;
  }

  leaveLobby(groupJid: string, userJid: string, nowMs = Date.now()): { cancelled: boolean; session: UndercoverSession } {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "lobby") {
      throw new AppUserError("Tidak ada lobby Undercover yang bisa ditinggalkan.");
    }

    const normUser = normalizeUserJid(userJid);
    const idx = session.players.findIndex((p) => p.userJid === normUser);
    if (idx < 0) {
      throw new AppUserError("Kamu belum bergabung di lobby Undercover.");
    }

    session.players.splice(idx, 1);
    if (session.players.length === 0) {
      this.sessions.delete(groupJid);
      return { cancelled: true, session };
    }

    session.players.forEach((p, i) => {
      p.slot = i + 1;
    });
    if (session.hostJid === normUser && session.players[0]) {
      session.hostJid = session.players[0].userJid;
    }
    return { cancelled: false, session };
  }

  stopSession(groupJid: string, actorJid: string, isAdminOrOwner: boolean, nowMs = Date.now()): void {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Tidak ada sesi Undercover aktif di grup ini.");
    }
    if (!isAdminOrOwner && session.hostJid !== normalizeUserJid(actorJid)) {
      throw new AppUserError("Hanya Host atau Admin yang bisa menghentikan sesi Undercover.");
    }
    this.sessions.delete(groupJid);
  }

  startGame(
    groupJid: string,
    actorJid: string,
    nowMs = Date.now(),
  ): { session: UndercoverSession; dmPayloads: { userJid: string; text: string }[] } {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "lobby") {
      throw new AppUserError("Belum ada lobby Undercover siap mulai.");
    }
    if (session.hostJid !== normalizeUserJid(actorJid)) {
      throw new AppUserError("Hanya Host lobby yang bisa menjalankan *.uc mulai*.");
    }
    if (session.players.length < UNDERCOVER_MIN_PLAYERS) {
      throw new AppUserError(
        `Minimal butuh ${String(UNDERCOVER_MIN_PLAYERS)} pemain untuk Undercover (saat ini ${String(session.players.length)}).`,
      );
    }

    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)] ?? ["Kopi", "Teh"];
    const swapOrder = Math.random() < 0.5;
    session.citizenWord = swapOrder ? pair[1] : pair[0];
    session.undercoverWord = swapOrder ? pair[0] : pair[1];

    const spyCount = session.players.length >= 7 ? 2 : 1;
    const roles: UndercoverRole[] = [];
    for (let i = 0; i < spyCount; i += 1) roles.push("undercover");
    while (roles.length < session.players.length) roles.push("warga");
    const shuffledRoles = this.shuffleFn(roles);

    session.players.forEach((p, idx) => {
      const role = shuffledRoles[idx] ?? "warga";
      p.role = role;
      p.word = role === "undercover" ? session.undercoverWord : session.citizenWord;
      p.alive = true;
    });
    session.phase = "voting";
    session.roundNumber = 1;
    session.votes.clear();
    session.expiresAt = nowMs + UNDERCOVER_TTL_MS;

    const dmPayloads = session.players.map((p) => ({
      userJid: p.userJid,
      text: [
        "*── [ KATA RAHASIA UNDERCOVER ] ──*",
        `Nomor Kamu : #${String(p.slot)}`,
        `Kata Rahasia: *${p.word}*`,
        "",
        "Berikan 1 petunjuk singkat di grup tanpa menyebut katamu langsung!",
        "Lalu cari siapa yang punya kata berbeda dan voting dengan *.uc vote <nomor>*.",
      ].join("\n"),
    }));

    return { session, dmPayloads };
  }

  async castVote(
    groupJid: string,
    voterJid: string,
    targetSlot: number,
    nowMs = Date.now(),
  ): Promise<{
    voterSlot: number;
    targetSlot: number;
    votedCount: number;
    aliveCount: number;
    autoResolved: UndercoverVoteResolution | null;
  }> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "voting") {
      throw new AppUserError("Tidak ada sesi Undercover aktif di grup ini.");
    }

    const voter = session.players.find((p) => p.userJid === normalizeUserJid(voterJid));
    if (!voter?.alive) {
      throw new AppUserError("Hanya pemain yang masih bertahan yang bisa voting.");
    }
    const target = session.players.find((p) => p.slot === targetSlot && p.alive);
    if (!target) {
      throw new AppUserError(`Pemain nomor #${String(targetSlot)} tidak valid atau sudah tersingkir.`);
    }

    session.votes.set(voter.slot, target.slot);
    const aliveCount = session.players.filter((p) => p.alive).length;
    const votedCount = session.votes.size;
    const autoResolved =
      votedCount >= aliveCount ? await this.resolveVotes(groupJid, nowMs) : null;

    return { voterSlot: voter.slot, targetSlot: target.slot, votedCount, aliveCount, autoResolved };
  }

  async resolveVotes(groupJid: string, nowMs = Date.now()): Promise<UndercoverVoteResolution> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "voting") {
      throw new AppUserError("Tidak ada sesi Undercover aktif untuk dihitung.");
    }

    const tally = new Map<number, number>();
    for (const targetSlot of session.votes.values()) {
      tally.set(targetSlot, (tally.get(targetSlot) ?? 0) + 1);
    }

    let topSlot: number | null = null;
    let topVotes = 0;
    let wasTie = false;
    for (const [slot, count] of tally.entries()) {
      if (count > topVotes) {
        topVotes = count;
        topSlot = slot;
        wasTie = false;
      } else if (count === topVotes && count > 0) {
        wasTie = true;
      }
    }

    let eliminatedPlayer: UndercoverPlayer | null = null;
    if (!wasTie && topSlot !== null) {
      const target = session.players.find((p) => p.slot === topSlot && p.alive);
      if (target) {
        target.alive = false;
        eliminatedPlayer = target;
      }
    }

    session.votes.clear();
    session.roundNumber += 1;

    const aliveSpies = session.players.filter((p) => p.alive && p.role === "undercover");
    const aliveCitizens = session.players.filter((p) => p.alive && p.role === "warga");

    let winningTeam: UndercoverRole | null = null;
    if (aliveSpies.length === 0) {
      winningTeam = "warga";
    } else if (aliveSpies.length >= aliveCitizens.length) {
      winningTeam = "undercover";
    }

    let winner: UndercoverWinnerSummary | null = null;
    if (winningTeam) {
      this.sessions.delete(groupJid);
      const winners = session.players.filter((p) => p.role === winningTeam);
      const rewardMoneyBase =
        winningTeam === "undercover" ? UNDERCOVER_SPY_REWARD : UNDERCOVER_WARGA_REWARD;
      const rewardXp = winningTeam === "undercover" ? 250 : 200;
      const rewardPoints = winningTeam === "undercover" ? 50 : 40;
      const correlationId = generateCorrelationId();

      await Promise.allSettled(
        winners.flatMap((w) => [
          this.economy.creditMoney({
            groupJid,
            userJid: w.userJid,
            amount: rewardMoneyBase,
            type: "GAME_REWARD",
            scaleByLevel: true,
            correlationId,
            note: `undercover_win_${winningTeam}`,
          }),
          this.economy.creditPoints({
            groupJid,
            userJid: w.userJid,
            amount: rewardPoints,
            type: "GAME_REWARD",
            correlationId,
            note: "undercover_win_points",
          }),
          this.economy.creditXp({
            groupJid,
            userJid: w.userJid,
            amount: rewardXp,
            type: "GAME_REWARD",
            correlationId,
            note: "undercover_win_xp",
          }),
        ]),
      );

      winner = { winningTeam, winners, rewardMoneyBase, rewardXp, rewardPoints };
    }

    return { eliminatedPlayer, wasTie, winner, session };
  }

  private sweepExpired(nowMs: number): void {
    for (const [k, s] of this.sessions.entries()) {
      if (s.expiresAt <= nowMs) this.sessions.delete(k);
    }
  }
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    const swp = arr[j];
    if (tmp !== undefined && swp !== undefined) {
      arr[i] = swp;
      arr[j] = tmp;
    }
  }
  return arr;
}

export const undercoverService = new UndercoverService();
