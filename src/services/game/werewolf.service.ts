import { AppUserError } from "../../errors/appUserError";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId, MemberEconomyService } from "../member/memberEconomy.service";

export type WerewolfRole = "werewolf" | "seer" | "guardian" | "warga";
export type WerewolfPhase = "lobby" | "night" | "day";

export interface WerewolfPlayer {
  slot: number;
  userJid: string;
  role: WerewolfRole;
  alive: boolean;
}

export interface WerewolfSession {
  groupJid: string;
  hostJid: string;
  phase: WerewolfPhase;
  dayNumber: number;
  players: WerewolfPlayer[];
  createdAt: number;
  expiresAt: number;
  nightKillTargetSlot: number | null;
  nightGuardTargetSlot: number | null;
  nightActedSlots: Set<number>;
  dayVotes: Map<number, number>; // voterSlot -> targetSlot
}

export interface WerewolfStartResult {
  session: WerewolfSession;
  dmPayloads: { userJid: string; text: string }[];
}

export interface WerewolfNightActionResult {
  groupJid: string;
  actorSlot: number;
  dmReply: string;
  autoResolvedDay: WerewolfNightResolution | null;
}

export interface WerewolfNightResolution {
  groupJid: string;
  dayNumber: number;
  killedPlayer: WerewolfPlayer | null;
  savedByGuardian: boolean;
  winner: WerewolfWinnerSummary | null;
  session: WerewolfSession;
}

export interface WerewolfDayVoteResult {
  voterSlot: number;
  targetSlot: number;
  votedCount: number;
  aliveCount: number;
  autoResolved: WerewolfDayResolution | null;
}

export interface WerewolfDayResolution {
  groupJid: string;
  eliminatedPlayer: WerewolfPlayer | null;
  wasTie: boolean;
  winner: WerewolfWinnerSummary | null;
  nextNightDmPrompts: { userJid: string; text: string }[];
  session: WerewolfSession;
}

export interface WerewolfWinnerSummary {
  winningTeam: "werewolf" | "warga";
  winners: WerewolfPlayer[];
  losers: WerewolfPlayer[];
  rewardMoneyBase: bigint;
  rewardXp: number;
  rewardPoints: number;
}

export const WEREWOLF_MIN_PLAYERS = 4;
export const WEREWOLF_MAX_PLAYERS = 12;
export const WEREWOLF_TTL_MS = 20 * 60 * 1000;
const MAX_WEREWOLF_ROOMS = 50;

export const WEREWOLF_WIN_MONEY = 25_000_000n;
export const WEREWOLF_WIN_XP = 250;
export const WEREWOLF_WIN_POINTS = 50;
export const WEREWOLF_LOSE_XP = 50;

interface WerewolfEconomy {
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

const ROLE_LABELS: Record<WerewolfRole, string> = {
  werewolf: "WEREWOLF",
  seer: "SEER (Penerawang)",
  guardian: "GUARDIAN (Pelindung)",
  warga: "WARGA DESA",
};

const ROLE_INSTRUCTIONS: Record<WerewolfRole, string> = {
  werewolf:
    "Tugasmu: Eliminasi warga setiap malam tanpa ketahuan! Saat malam tiba, kirim DM ke bot: *.ww bunuh <nomor>*",
  seer:
    "Tugasmu: Terawang identitas pemain di malam hari! Saat malam tiba, kirim DM ke bot: *.ww terawang <nomor>*",
  guardian:
    "Tugasmu: Lindungi 1 pemain tiap malam dari serangan Werewolf! Saat malam tiba, kirim DM ke bot: *.ww lindungi <nomor>*",
  warga:
    "Tugasmu: Diskusi di grup saat siang & temukan Werewolf lewat voting (*.ww vote <nomor>)!",
};

export function assignWerewolfRoles(
  playerCount: number,
  shuffleFn: <T>(arr: T[]) => T[] = fisherYatesShuffle,
): WerewolfRole[] {
  const wolfCount = playerCount >= 9 ? 3 : playerCount >= 6 ? 2 : 1;
  const roles: WerewolfRole[] = [];
  for (let i = 0; i < wolfCount; i += 1) {
    roles.push("werewolf");
  }
  roles.push("seer", "guardian");
  while (roles.length < playerCount) {
    roles.push("warga");
  }
  return shuffleFn(roles);
}

export class WerewolfService {
  private readonly sessions = new Map<string, WerewolfSession>();

  constructor(
    private readonly economy: WerewolfEconomy = new MemberEconomyService(),
    private readonly shuffleFn: <T>(arr: T[]) => T[] = fisherYatesShuffle,
  ) {}

  getSession(groupJid: string, nowMs = Date.now()): WerewolfSession | null {
    this.sweepExpired(nowMs);
    return this.sessions.get(groupJid) ?? null;
  }

  findSessionForPlayer(
    candidateJids: readonly string[],
    nowMs = Date.now(),
  ): { session: WerewolfSession; player: WerewolfPlayer } | null {
    this.sweepExpired(nowMs);
    const normalizedSet = new Set(candidateJids.map((j) => normalizeUserJid(j)).filter(Boolean));
    for (const session of this.sessions.values()) {
      const player = session.players.find((p) => normalizedSet.has(normalizeUserJid(p.userJid)));
      if (player) {
        return { session, player };
      }
    }
    return null;
  }

  createLobby(groupJid: string, hostJid: string, nowMs = Date.now()): WerewolfSession {
    this.sweepExpired(nowMs);
    const existing = this.sessions.get(groupJid);
    if (existing) {
      throw new AppUserError(
        "Sudah ada sesi Werewolf aktif di grup ini! Ketik *.ww join* atau *.ww status*.",
      );
    }

    if (this.sessions.size >= MAX_WEREWOLF_ROOMS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }

    const normHost = normalizeUserJid(hostJid);
    const session: WerewolfSession = {
      groupJid,
      hostJid: normHost,
      phase: "lobby",
      dayNumber: 0,
      players: [{ slot: 1, userJid: normHost, role: "warga", alive: true }],
      createdAt: nowMs,
      expiresAt: nowMs + WEREWOLF_TTL_MS,
      nightKillTargetSlot: null,
      nightGuardTargetSlot: null,
      nightActedSlots: new Set(),
      dayVotes: new Map(),
    };
    this.sessions.set(groupJid, session);
    return session;
  }

  joinLobby(groupJid: string, userJid: string, nowMs = Date.now()): WerewolfSession {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada lobby Werewolf. Ketik *.ww buat* untuk membuat!");
    }
    if (session.phase !== "lobby") {
      throw new AppUserError("Permainan Werewolf sedang berlangsung, tidak bisa join di tengah ronde.");
    }

    const normUser = normalizeUserJid(userJid);
    if (session.players.some((p) => p.userJid === normUser)) {
      throw new AppUserError("Kamu sudah terdaftar di lobby Werewolf ini.");
    }
    if (session.players.length >= WEREWOLF_MAX_PLAYERS) {
      throw new AppUserError(
        `Lobby Werewolf sudah penuh (${String(WEREWOLF_MAX_PLAYERS)}/${String(WEREWOLF_MAX_PLAYERS)} pemain).`,
      );
    }

    session.players.push({
      slot: session.players.length + 1,
      userJid: normUser,
      role: "warga",
      alive: true,
    });
    return session;
  }

  leaveLobby(groupJid: string, userJid: string, nowMs = Date.now()): { cancelled: boolean; session: WerewolfSession } {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "lobby") {
      throw new AppUserError("Tidak ada lobby Werewolf yang bisa ditinggalkan.");
    }

    const normUser = normalizeUserJid(userJid);
    const idx = session.players.findIndex((p) => p.userJid === normUser);
    if (idx < 0) {
      throw new AppUserError("Kamu belum bergabung di lobby Werewolf ini.");
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
      throw new AppUserError("Tidak ada sesi Werewolf aktif di grup ini.");
    }
    const normActor = normalizeUserJid(actorJid);
    if (!isAdminOrOwner && session.hostJid !== normActor) {
      throw new AppUserError("Hanya host atau Admin grup yang bisa menghentikan sesi Werewolf.");
    }
    this.sessions.delete(groupJid);
  }

  startGame(groupJid: string, actorJid: string, nowMs = Date.now()): WerewolfStartResult {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada lobby Werewolf. Ketik *.ww buat* terlebih dahulu.");
    }
    if (session.phase !== "lobby") {
      throw new AppUserError("Permainan Werewolf sudah berjalan.");
    }

    const normActor = normalizeUserJid(actorJid);
    if (session.hostJid !== normActor) {
      throw new AppUserError("Hanya host pembuat lobby yang bisa menjalankan *.ww mulai*.");
    }
    if (session.players.length < WEREWOLF_MIN_PLAYERS) {
      throw new AppUserError(
        `Minimal butuh ${String(WEREWOLF_MIN_PLAYERS)} pemain untuk memulai Werewolf (saat ini ${String(session.players.length)} pemain).`,
      );
    }

    const assigned = assignWerewolfRoles(session.players.length, this.shuffleFn);
    session.players.forEach((p, idx) => {
      p.role = assigned[idx] ?? "warga";
      p.alive = true;
    });
    session.phase = "night";
    session.dayNumber = 1;
    session.expiresAt = nowMs + WEREWOLF_TTL_MS;
    session.nightKillTargetSlot = null;
    session.nightGuardTargetSlot = null;
    session.nightActedSlots.clear();
    session.dayVotes.clear();

    const rosterText = formatRosterLines(session.players);
    const wolfSlots = session.players
      .filter((p) => p.role === "werewolf")
      .map((p) => `#${String(p.slot)} (@${phoneOf(p.userJid)})`);

    const dmPayloads = session.players.map((p) => {
      const teamInfo =
        p.role === "werewolf" && wolfSlots.length > 1
          ? `\nRekan Werewolf kamu: ${wolfSlots.join(", ")}`
          : "";
      return {
        userJid: p.userJid,
        text: [
          "*── [ ROLE WEREWOLF KAMU ] ──*",
          `Peran  : *${ROLE_LABELS[p.role]}*`,
          `Nomor  : #${String(p.slot)}`,
          teamInfo,
          "",
          ROLE_INSTRUCTIONS[p.role],
          "",
          "*Daftar Pemain:*",
          rosterText,
        ]
          .filter((line) => line !== "")
          .join("\n"),
      };
    });

    return { session, dmPayloads };
  }

  async performNightAction(
    candidateJids: readonly string[],
    action: "bunuh" | "terawang" | "lindungi",
    targetSlot: number,
    nowMs = Date.now(),
  ): Promise<WerewolfNightActionResult> {
    const found = this.findSessionForPlayer(candidateJids, nowMs);
    if (!found) {
      throw new AppUserError("Kamu tidak sedang bermain di sesi Werewolf aktif mana pun.");
    }

    const { session, player } = found;
    if (session.phase !== "night") {
      throw new AppUserError("Aksi malam hanya bisa dilakukan saat fase MALAM.");
    }
    if (!player.alive) {
      throw new AppUserError("Kamu sudah tereliminasi dan tidak bisa melakukan aksi malam.");
    }

    const expectedRole: Record<typeof action, WerewolfRole> = {
      bunuh: "werewolf",
      terawang: "seer",
      lindungi: "guardian",
    };
    if (player.role !== expectedRole[action]) {
      throw new AppUserError(`Perintah *.ww ${action}* bukan untuk peranmu (${ROLE_LABELS[player.role]}).`);
    }

    if (session.nightActedSlots.has(player.slot)) {
      throw new AppUserError("Kamu sudah memakai aksi malammu di malam ini.");
    }

    const target = session.players.find((p) => p.slot === targetSlot);
    if (!target?.alive) {
      throw new AppUserError(`Pemain nomor #${String(targetSlot)} tidak ditemukan atau sudah gugur.`);
    }
    if (action === "bunuh" && target.role === "werewolf") {
      throw new AppUserError("Werewolf tidak bisa membunuh sesama Werewolf!");
    }

    session.nightActedSlots.add(player.slot);

    let dmReply: string;
    if (action === "bunuh") {
      session.nightKillTargetSlot = target.slot;
      dmReply = `Target serangan malam ini dikunci pada pemain #${String(target.slot)} (@${phoneOf(target.userJid)}).`;
    } else if (action === "lindungi") {
      session.nightGuardTargetSlot = target.slot;
      dmReply = `Kamu menjaga pemain #${String(target.slot)} (@${phoneOf(target.userJid)}) malam ini.`;
    } else {
      const verdict = target.role === "werewolf" ? "WEREWOLF! (Bahaya!)" : "BUKAN Werewolf (Aman).";
      dmReply = `Hasil penerawangan #${String(target.slot)} (@${phoneOf(target.userJid)}): *${verdict}*`;
    }

    const allSpecialsDone = this.areAllAliveNightRolesActed(session);
    const autoResolvedDay = allSpecialsDone ? await this.resolveNight(session.groupJid, nowMs) : null;

    return {
      groupJid: session.groupJid,
      actorSlot: player.slot,
      dmReply,
      autoResolvedDay,
    };
  }

  async resolveNight(groupJid: string, nowMs = Date.now()): Promise<WerewolfNightResolution> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "night") {
      throw new AppUserError("Saat ini bukan fase malam Werewolf.");
    }

    let killedPlayer: WerewolfPlayer | null = null;
    let savedByGuardian = false;

    if (session.nightKillTargetSlot !== null) {
      if (session.nightKillTargetSlot === session.nightGuardTargetSlot) {
        savedByGuardian = true;
      } else {
        const victim = session.players.find(
          (p) => p.slot === session.nightKillTargetSlot && p.alive,
        );
        if (victim) {
          victim.alive = false;
          killedPlayer = victim;
        }
      }
    }

    session.nightKillTargetSlot = null;
    session.nightGuardTargetSlot = null;
    session.nightActedSlots.clear();
    session.dayVotes.clear();
    session.phase = "day";

    const winner = await this.checkAndSettleWinner(session);
    return {
      groupJid,
      dayNumber: session.dayNumber,
      killedPlayer,
      savedByGuardian,
      winner,
      session,
    };
  }

  async castDayVote(
    groupJid: string,
    voterJid: string,
    targetSlot: number,
    nowMs = Date.now(),
  ): Promise<WerewolfDayVoteResult> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "day") {
      throw new AppUserError("Voting hanya bisa dilakukan saat fase SIANG di grup.");
    }

    const normVoter = normalizeUserJid(voterJid);
    const voter = session.players.find((p) => p.userJid === normVoter);
    if (!voter?.alive) {
      throw new AppUserError("Hanya pemain yang masih hidup di sesi ini yang bisa ikut voting.");
    }

    const target = session.players.find((p) => p.slot === targetSlot && p.alive);
    if (!target) {
      throw new AppUserError(`Pemain nomor #${String(targetSlot)} tidak valid atau sudah gugur.`);
    }

    session.dayVotes.set(voter.slot, target.slot);
    const aliveCount = session.players.filter((p) => p.alive).length;
    const votedCount = session.dayVotes.size;

    const autoResolved =
      votedCount >= aliveCount ? await this.resolveDayVote(groupJid, nowMs) : null;

    return {
      voterSlot: voter.slot,
      targetSlot: target.slot,
      votedCount,
      aliveCount,
      autoResolved,
    };
  }

  async resolveDayVote(groupJid: string, nowMs = Date.now()): Promise<WerewolfDayResolution> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "day") {
      throw new AppUserError("Saat ini bukan fase voting siang Werewolf.");
    }

    const tally = new Map<number, number>();
    for (const targetSlot of session.dayVotes.values()) {
      tally.set(targetSlot, (tally.get(targetSlot) ?? 0) + 1);
    }

    let topSlot: number | null = null;
    let topVotes = 0;
    let isTie = false;

    for (const [slot, count] of tally.entries()) {
      if (count > topVotes) {
        topVotes = count;
        topSlot = slot;
        isTie = false;
      } else if (count === topVotes && count > 0) {
        isTie = true;
      }
    }

    let eliminatedPlayer: WerewolfPlayer | null = null;
    if (!isTie && topSlot !== null) {
      const target = session.players.find((p) => p.slot === topSlot && p.alive);
      if (target) {
        target.alive = false;
        eliminatedPlayer = target;
      }
    }

    session.dayVotes.clear();
    const winner = await this.checkAndSettleWinner(session);

    const nextNightDmPrompts: { userJid: string; text: string }[] = [];
    if (!winner) {
      session.phase = "night";
      session.dayNumber += 1;
      session.nightActedSlots.clear();
      session.nightKillTargetSlot = null;
      session.nightGuardTargetSlot = null;
      const aliveRoster = formatRosterLines(session.players);

      for (const p of session.players) {
        if (p.alive && p.role !== "warga") {
          nextNightDmPrompts.push({
            userJid: p.userJid,
            text: [
              `*── [ MALAM KE-${String(session.dayNumber)} ] ──*`,
              `Peranmu: *${ROLE_LABELS[p.role]}*`,
              ROLE_INSTRUCTIONS[p.role],
              "",
              aliveRoster,
            ].join("\n"),
          });
        }
      }
    }

    return {
      groupJid,
      eliminatedPlayer,
      wasTie: isTie,
      winner,
      nextNightDmPrompts,
      session,
    };
  }

  private areAllAliveNightRolesActed(session: WerewolfSession): boolean {
    const aliveWolves = session.players.filter((p) => p.alive && p.role === "werewolf");
    const wolfActed =
      aliveWolves.length === 0 || aliveWolves.some((w) => session.nightActedSlots.has(w.slot));
    const seerDone = session.players
      .filter((p) => p.alive && p.role === "seer")
      .every((p) => session.nightActedSlots.has(p.slot));
    const guardDone = session.players
      .filter((p) => p.alive && p.role === "guardian")
      .every((p) => session.nightActedSlots.has(p.slot));
    return wolfActed && seerDone && guardDone;
  }

  private async checkAndSettleWinner(
    session: WerewolfSession,
  ): Promise<WerewolfWinnerSummary | null> {
    const aliveWolves = session.players.filter((p) => p.alive && p.role === "werewolf");
    const aliveVillagers = session.players.filter((p) => p.alive && p.role !== "werewolf");

    let winningTeam: "werewolf" | "warga" | null = null;
    if (aliveWolves.length === 0) {
      winningTeam = "warga";
    } else if (aliveWolves.length >= aliveVillagers.length) {
      winningTeam = "werewolf";
    }

    if (!winningTeam) {
      return null;
    }

    this.sessions.delete(session.groupJid);
    const winners = session.players.filter((p) =>
      winningTeam === "werewolf" ? p.role === "werewolf" : p.role !== "werewolf",
    );
    const losers = session.players.filter((p) => !winners.includes(p));
    const correlationId = generateCorrelationId();

    await Promise.allSettled([
      ...winners.flatMap((w) => [
        this.economy.creditMoney({
          groupJid: session.groupJid,
          userJid: w.userJid,
          amount: WEREWOLF_WIN_MONEY,
          type: "GAME_REWARD",
          scaleByLevel: true,
          correlationId,
          note: `werewolf_win_${winningTeam}`,
        }),
        this.economy.creditPoints({
          groupJid: session.groupJid,
          userJid: w.userJid,
          amount: WEREWOLF_WIN_POINTS,
          type: "GAME_REWARD",
          correlationId,
          note: "werewolf_win_points",
        }),
        this.economy.creditXp({
          groupJid: session.groupJid,
          userJid: w.userJid,
          amount: WEREWOLF_WIN_XP,
          type: "GAME_REWARD",
          correlationId,
          note: "werewolf_win_xp",
        }),
      ]),
      ...losers.map((l) =>
        this.economy.creditXp({
          groupJid: session.groupJid,
          userJid: l.userJid,
          amount: WEREWOLF_LOSE_XP,
          type: "GAME_REWARD",
          correlationId,
          note: "werewolf_lose_xp",
        }),
      ),
    ]);

    return {
      winningTeam,
      winners,
      losers,
      rewardMoneyBase: WEREWOLF_WIN_MONEY,
      rewardXp: WEREWOLF_WIN_XP,
      rewardPoints: WEREWOLF_WIN_POINTS,
    };
  }

  private sweepExpired(nowMs: number): void {
    for (const [k, s] of this.sessions.entries()) {
      if (s.expiresAt <= nowMs) {
        this.sessions.delete(k);
      }
    }
  }
}

export function formatRosterLines(players: readonly WerewolfPlayer[], revealRoles = false): string {
  return players
    .map((p) => {
      const status = p.alive ? "Hidup" : "Gugur";
      const rolePart = revealRoles ? ` [${ROLE_LABELS[p.role]}]` : "";
      return `${String(p.slot)}. @${phoneOf(p.userJid)} (${status})${rolePart}`;
    })
    .join("\n");
}

function phoneOf(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    const swap = arr[j];
    if (tmp !== undefined && swap !== undefined) {
      arr[i] = swap;
      arr[j] = tmp;
    }
  }
  return arr;
}

export const werewolfService = new WerewolfService();
