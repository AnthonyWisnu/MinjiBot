import type { GroupNote } from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupNoteRepository, normalizeNoteTitle } from "../../repositories/groupNote.repository";
import { normalizeUserJid } from "../../utils/jid";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NOTES_PER_GROUP = 30;
const MAX_NOTE_TITLE_LEN = 40;
const MAX_NOTE_CONTENT_LEN = 2000;

export interface AttendanceEntry {
  userJid: string;
  timeWib: string;
}

export interface AttendanceSession {
  groupJid: string;
  title: string;
  createdBy: string;
  createdAt: number;
  entries: AttendanceEntry[];
}

export interface VoteSession {
  groupJid: string;
  topic: string;
  createdBy: string;
  createdAt: number;
  upvoters: Set<string>;
  downvoters: Set<string>;
}

interface NoteStore {
  findByTitle(groupJid: string, title: string): Promise<GroupNote | null>;
  listByGroup(groupJid: string): Promise<GroupNote[]>;
  countByGroup(groupJid: string): Promise<number>;
  upsert(groupJid: string, title: string, content: string, createdBy: string): Promise<GroupNote>;
  deleteByTitle(groupJid: string, title: string): Promise<boolean>;
}

function formatWibTime(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export class GroupToolsService {
  private readonly attendanceMap = new Map<string, AttendanceSession>();
  private readonly voteMap = new Map<string, VoteSession>();

  constructor(private readonly noteRepo: NoteStore = new GroupNoteRepository()) {}

  // ---- Absen ----

  startAttendance(
    groupJid: string,
    creatorJid: string,
    title: string,
    nowMs = Date.now(),
  ): AttendanceSession {
    const existing = this.attendanceMap.get(groupJid);
    if (existing && nowMs - existing.createdAt < SESSION_TTL_MS) {
      throw new AppUserError(
        `Masih ada sesi absen aktif: "${existing.title}". Gunakan .hapusabsen dulu untuk membuat yang baru.`,
      );
    }

    const cleanTitle = title.trim() || "Absen Harian Grup";
    const session: AttendanceSession = {
      groupJid,
      title: cleanTitle.slice(0, 100),
      createdBy: normalizeUserJid(creatorJid),
      createdAt: nowMs,
      entries: [],
    };
    this.attendanceMap.set(groupJid, session);
    return session;
  }

  markAttendance(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): { session: AttendanceSession; alreadyPresent: boolean } {
    const session = this.getActiveAttendance(groupJid, now.getTime());
    const normUser = normalizeUserJid(userJid);

    if (session.entries.some((e) => e.userJid === normUser)) {
      return { session, alreadyPresent: true };
    }

    session.entries.push({
      userJid: normUser,
      timeWib: `${formatWibTime(now)} WIB`,
    });

    return { session, alreadyPresent: false };
  }

  getAttendance(groupJid: string, nowMs = Date.now()): AttendanceSession {
    return this.getActiveAttendance(groupJid, nowMs);
  }

  deleteAttendance(
    groupJid: string,
    actorJid: string,
    isAdminOrOwner: boolean,
    nowMs = Date.now(),
  ): AttendanceSession {
    const session = this.getActiveAttendance(groupJid, nowMs);
    if (!isAdminOrOwner && normalizeUserJid(actorJid) !== session.createdBy) {
      throw new AppUserError("Hanya pembuat absen atau Admin/Owner yang dapat menghapus sesi absen.");
    }
    this.attendanceMap.delete(groupJid);
    return session;
  }

  private getActiveAttendance(groupJid: string, nowMs: number): AttendanceSession {
    const session = this.attendanceMap.get(groupJid);
    if (!session || nowMs - session.createdAt >= SESSION_TTL_MS) {
      this.attendanceMap.delete(groupJid);
      throw new AppUserError("Belum ada sesi absen aktif. Mulai dengan .mulaiabsen [judul].");
    }
    return session;
  }

  // ---- Voting ----

  startVote(
    groupJid: string,
    creatorJid: string,
    topic: string,
    nowMs = Date.now(),
  ): VoteSession {
    const existing = this.voteMap.get(groupJid);
    if (existing && nowMs - existing.createdAt < SESSION_TTL_MS) {
      throw new AppUserError(
        `Masih ada sesi voting aktif: "${existing.topic}". Gunakan .hapusvote dulu untuk menutupnya.`,
      );
    }

    const cleanTopic = topic.trim() || "Voting Grup";
    const session: VoteSession = {
      groupJid,
      topic: cleanTopic.slice(0, 120),
      createdBy: normalizeUserJid(creatorJid),
      createdAt: nowMs,
      upvoters: new Set<string>(),
      downvoters: new Set<string>(),
    };
    this.voteMap.set(groupJid, session);
    return session;
  }

  castVote(
    groupJid: string,
    userJid: string,
    choice: "up" | "down",
    nowMs = Date.now(),
  ): VoteSession {
    const session = this.getActiveVote(groupJid, nowMs);
    const normUser = normalizeUserJid(userJid);

    if (choice === "up") {
      session.downvoters.delete(normUser);
      session.upvoters.add(normUser);
    } else {
      session.upvoters.delete(normUser);
      session.downvoters.add(normUser);
    }

    return session;
  }

  getVote(groupJid: string, nowMs = Date.now()): VoteSession {
    return this.getActiveVote(groupJid, nowMs);
  }

  deleteVote(
    groupJid: string,
    actorJid: string,
    isAdminOrOwner: boolean,
    nowMs = Date.now(),
  ): VoteSession {
    const session = this.getActiveVote(groupJid, nowMs);
    if (!isAdminOrOwner && normalizeUserJid(actorJid) !== session.createdBy) {
      throw new AppUserError("Hanya pembuat voting atau Admin/Owner yang dapat menutup voting.");
    }
    this.voteMap.delete(groupJid);
    return session;
  }

  private getActiveVote(groupJid: string, nowMs: number): VoteSession {
    const session = this.voteMap.get(groupJid);
    if (!session || nowMs - session.createdAt >= SESSION_TTL_MS) {
      this.voteMap.delete(groupJid);
      throw new AppUserError("Belum ada sesi voting aktif. Mulai dengan .mulaivote <topik>.");
    }
    return session;
  }

  // ---- Persistent Group Notes ----

  async saveNote(
    groupJid: string,
    rawTitle: string,
    rawContent: string,
    createdBy: string,
  ): Promise<GroupNote> {
    const title = normalizeNoteTitle(rawTitle);
    const content = rawContent.trim();
    if (!title || title.length > MAX_NOTE_TITLE_LEN) {
      throw new AppUserError(`Judul catatan wajib diisi (maksimal ${String(MAX_NOTE_TITLE_LEN)} karakter).`);
    }
    if (!content || content.length > MAX_NOTE_CONTENT_LEN) {
      throw new AppUserError(
        `Isi catatan wajib diisi (maksimal ${String(MAX_NOTE_CONTENT_LEN)} karakter).`,
      );
    }

    const existing = await this.noteRepo.findByTitle(groupJid, title);
    if (!existing) {
      const count = await this.noteRepo.countByGroup(groupJid);
      if (count >= MAX_NOTES_PER_GROUP) {
        throw new AppUserError(
          `Batas maksimal ${String(MAX_NOTES_PER_GROUP)} catatan per grup tercapai. Hapus catatan lama dengan .hapuscatatan.`,
        );
      }
    }

    return this.noteRepo.upsert(groupJid, title, content, normalizeUserJid(createdBy));
  }

  async getNote(groupJid: string, rawTitle: string): Promise<GroupNote> {
    const note = await this.noteRepo.findByTitle(groupJid, rawTitle);
    if (!note) {
      throw new AppUserError(
        `Catatan "${rawTitle.trim()}" tidak ditemukan. Cek daftar catatan dengan .listcatatan.`,
      );
    }
    return note;
  }

  listNotes(groupJid: string): Promise<GroupNote[]> {
    return this.noteRepo.listByGroup(groupJid);
  }

  async deleteNote(
    groupJid: string,
    rawTitle: string,
    actorJid: string,
    isAdminOrOwner: boolean,
  ): Promise<void> {
    const existing = await this.noteRepo.findByTitle(groupJid, rawTitle);
    if (!existing) {
      throw new AppUserError(`Catatan "${rawTitle.trim()}" tidak ditemukan.`);
    }

    if (!isAdminOrOwner && normalizeUserJid(actorJid) !== existing.createdBy) {
      throw new AppUserError("Hanya pembuat catatan atau Admin/Owner yang dapat menghapus catatan ini.");
    }

    await this.noteRepo.deleteByTitle(groupJid, rawTitle);
  }
}

export const groupToolsService = new GroupToolsService();
