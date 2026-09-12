import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import type { WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

export interface SoundItem {
  id: string;
  title: string;
  category: "meme" | "sfx" | "gaming" | "reaction";
  durationSeconds: number;
  description: string;
  badge: string;
}

export const SOUNDBOARD_CATALOG: SoundItem[] = [
  {
    id: "vine-boom",
    title: "Vine Boom",
    category: "meme",
    durationSeconds: 1.5,
    description: "Bass drop dramatis yang viral di video meme",
    badge: "VIRAL",
  },
  {
    id: "air-horn",
    title: "MLG Airhorn",
    category: "meme",
    durationSeconds: 2.0,
    description: "Suara klakson terompet triple fanfare khas MLG",
    badge: "CLASSIC",
  },
  {
    id: "ba-dum-tss",
    title: "Ba-Dum-Tss",
    category: "sfx",
    durationSeconds: 2.2,
    description: "Ketukan drum punchline setelah lelucon bapak-bapak",
    badge: "COMEDY",
  },
  {
    id: "sad-trombone",
    title: "Sad Trombone",
    category: "reaction",
    durationSeconds: 3.0,
    description: "Suara terompet sedih 'Wah Wah Wah Waaah' saat gagal",
    badge: "FAIL",
  },
  {
    id: "bruh-effect",
    title: "Bruh Moment",
    category: "meme",
    durationSeconds: 1.2,
    description: "Efek vokal 'Bruh' rendah untuk momen mengecewakan",
    badge: "REACTION",
  },
  {
    id: "taco-bell",
    title: "Taco Bell Bong",
    category: "meme",
    durationSeconds: 2.0,
    description: "Suara dentang lonceng besi beresonansi",
    badge: "BONG",
  },
  {
    id: "retro-coin",
    title: "8-Bit Coin",
    category: "gaming",
    durationSeconds: 0.8,
    description: "Koleksi koin emas bergaya retro game klasik",
    badge: "RETRO",
  },
  {
    id: "laser-shot",
    title: "Cyber Laser",
    category: "gaming",
    durationSeconds: 0.9,
    description: "Suara tembakan laser sci-fi menyapu frekuensi tinggi",
    badge: "SCI-FI",
  },
  {
    id: "level-up",
    title: "Victory Fanfare",
    category: "gaming",
    durationSeconds: 2.5,
    description: "Jingle arpeggio kemenangan 8-bit saat naik level",
    badge: "WIN",
  },
  {
    id: "error-buzz",
    title: "System Error",
    category: "sfx",
    durationSeconds: 1.0,
    description: "Suara buzzer peringatan kesalahan sistem komputer",
    badge: "ALERT",
  },
  {
    id: "cricket-silence",
    title: "Awkward Cricket",
    category: "reaction",
    durationSeconds: 3.5,
    description: "Suara jangkrik malam untuk suasana hening yang canggung",
    badge: "CRICKET",
  },
];

export class SoundboardService {
  getCatalog(): SoundItem[] {
    return SOUNDBOARD_CATALOG;
  }

  getSoundItem(id: string): SoundItem | undefined {
    return SOUNDBOARD_CATALOG.find((s) => s.id === id);
  }

  /**
   * Mengambil audio buffer untuk sebuah sound.
   * Prioritas 1: File custom di assets/sounds/<id>.mp3 atau .wav jika disediakan.
   * Prioritas 2: Synthesizer prosedural audio WAV matematis (zero external dependency).
   */
  async getSoundBuffer(soundId: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const customPathMp3 = path.resolve(process.cwd(), "assets", "sounds", `${soundId}.mp3`);
    const customPathWav = path.resolve(process.cwd(), "assets", "sounds", `${soundId}.wav`);

    if (existsSync(customPathMp3)) {
      const buffer = await readFile(customPathMp3);
      return { buffer, mimetype: "audio/mpeg" };
    }

    if (existsSync(customPathWav)) {
      const buffer = await readFile(customPathWav);
      return { buffer, mimetype: "audio/wav" };
    }

    // Generate synthesized audio WAV buffer
    const wavBuffer = synthesizeSoundWave(soundId);
    return { buffer: wavBuffer, mimetype: "audio/wav" };
  }

  /**
   * Mengirim soundboard audio sebagai WhatsApp Voice Note (PTT) ke chat tujuan.
   */
  async sendVoiceNote(chatJid: string, soundId: string, socket: WASocket): Promise<boolean> {
    const soundItem = this.getSoundItem(soundId);
    if (!soundItem) {
      throw new Error(`Sound ID '${soundId}' tidak ditemukan di katalog.`);
    }

    const { buffer: rawBuffer, mimetype } = await this.getSoundBuffer(soundId);
    const tempDir = await createTempDir("soundboard-vn");
    const inputPath = path.join(tempDir, mimetype === "audio/mpeg" ? "input.mp3" : "input.wav");
    const outputPath = path.join(tempDir, "output.ogg");

    try {
      await writeFile(inputPath, rawBuffer);
      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

      // Transcode ke OGG OPUS (format standar WhatsApp Voice Note)
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegPath, [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          "-c:a",
          "libopus",
          "-b:a",
          "64k",
          "-vbr",
          "on",
          outputPath,
        ]);

        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exit with code ${String(code)}`));
        });

        proc.on("error", reject);
      });

      const oggBuffer = await readFile(outputPath);

      await socket.sendMessage(
        chatJid,
        {
          audio: oggBuffer,
          mimetype: "audio/ogg; codecs=opus",
          ptt: true, // Render sebagai Voice Note hijau bergelombang
        },
      );

      logger.info({ chatJid, soundId: soundItem.id }, "Voice Note soundboard berhasil dikirim");
      return true;
    } finally {
      await removeTempDir(tempDir);
    }
  }
}

// ─── Procedural Audio Synthesis Engine (44.1kHz 16-bit Mono WAV) ───────────

function synthesizeSoundWave(soundId: string): Buffer {
  const sampleRate = 44100;
  let duration = 2.0;

  if (soundId === "retro-coin" || soundId === "laser-shot" || soundId === "error-buzz") {
    duration = 0.8;
  } else if (soundId === "cricket-silence" || soundId === "sad-trombone") {
    duration = 3.0;
  }

  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sampleVal = 0;

    switch (soundId) {
      case "vine-boom": {
        // Deep sub-bass 55Hz decaying to 25Hz with exponential decay & saturation
        const freq = Math.max(25, 55 - t * 25);
        const env = Math.exp(-t * 2.5);
        let s = Math.sin(2 * Math.PI * freq * t) * env;
        s = Math.tanh(s * 2.5); // Soft saturation distortion
        sampleVal = s;
        break;
      }
      case "air-horn": {
        // Triple fanfare blast: Bb4 (466Hz), Db5 (554Hz), Eb5 (622Hz) in pulses
        const pulse = (t % 0.4 < 0.25) ? 1 : 0;
        const s1 = Math.sin(2 * Math.PI * 466 * t);
        const s2 = Math.sin(2 * Math.PI * 554 * t);
        const s3 = Math.sin(2 * Math.PI * 622 * t);
        sampleVal = ((s1 + s2 + s3) / 3) * pulse * 0.8;
        break;
      }
      case "ba-dum-tss": {
        // 0-0.3s: Ba (bass drum), 0.3-0.6s: Dum (mid tom), 0.6-2.0s: Tss (cymbal noise)
        if (t < 0.3) {
          const env = Math.exp(-t * 12);
          sampleVal = Math.sin(2 * Math.PI * (120 - t * 200) * t) * env;
        } else if (t < 0.6) {
          const dt = t - 0.3;
          const env = Math.exp(-dt * 10);
          sampleVal = Math.sin(2 * Math.PI * (160 - dt * 150) * dt) * env;
        } else {
          const dt = t - 0.6;
          const env = Math.exp(-dt * 3.5);
          sampleVal = (Math.random() * 2 - 1) * env * 0.7; // White noise cymbal
        }
        break;
      }
      case "sad-trombone": {
        // 4 descending notes: D4 (293), C#4 (277), C4 (261), B3 (246 with wobble)
        const noteIdx = Math.min(3, Math.floor(t / 0.7));
        const baseFreqs = [293.66, 277.18, 261.63, 246.94];
        let freq = baseFreqs[noteIdx] ?? 246;
        if (noteIdx === 3) {
          freq += Math.sin(t * 20) * 8 - (t - 2.1) * 20; // downward wobble
        }
        const noteT = t % 0.7;
        const env = Math.max(0, 1 - noteT / 0.7);
        // Sawtooth-like brass harmonic
        sampleVal = (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(4 * Math.PI * freq * t)) * env * 0.6;
        break;
      }
      case "bruh-effect": {
        // Low vocal formant glide 110Hz to 85Hz
        const freq = Math.max(80, 110 - t * 40);
        const env = Math.sin(Math.min(Math.PI, t * Math.PI / 1.0));
        sampleVal = Math.sin(2 * Math.PI * freq * t) * env * 0.9;
        break;
      }
      case "taco-bell": {
        // Metallic gong chime 440Hz + 880Hz + 1320Hz with long decay
        const env = Math.exp(-t * 2.0);
        sampleVal = (Math.sin(2 * Math.PI * 432 * t) * 0.6 + Math.sin(2 * Math.PI * 864 * t) * 0.3 + Math.sin(2 * Math.PI * 1296 * t) * 0.1) * env;
        break;
      }
      case "retro-coin": {
        // Mario 8-bit coin: B5 (987Hz) for 0.08s then E6 (1318Hz) for 0.4s
        const freq = t < 0.08 ? 987.77 : 1318.51;
        const env = Math.exp(-t * 5.0);
        // Square wave
        sampleVal = (Math.sin(2 * Math.PI * freq * t) >= 0 ? 0.6 : -0.6) * env;
        break;
      }
      case "laser-shot": {
        // Cyber laser: 2200Hz sweep down to 180Hz
        const freq = Math.max(180, 2200 * Math.exp(-t * 10));
        const env = Math.exp(-t * 4.0);
        sampleVal = Math.sin(2 * Math.PI * freq * t) * env * 0.8;
        break;
      }
      case "level-up": {
        // Arpeggio: C5 (523), E5 (659), G5 (784), C6 (1046)
        const noteIdx = Math.min(3, Math.floor(t / 0.15));
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        const freq = freqs[noteIdx] ?? 1046;
        const env = Math.exp(-(t - noteIdx * 0.15) * 4.0);
        sampleVal = (Math.sin(2 * Math.PI * freq * t) >= 0 ? 0.5 : -0.5) * env;
        break;
      }
      default: {
        // Default chime
        sampleVal = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 3);
        break;
      }
    }

    // Clamp and convert to 16-bit integer
    sampleVal = Math.max(-1, Math.min(1, sampleVal));
    samples[i] = Math.floor(sampleVal * 32767);
  }

  return encodeWav(samples, sampleRate);
}

function encodeWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataByteLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataByteLength);

  // RIFF Header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write("WAVE", 8);

  // fmt Subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(2, 32);  // BlockAlign (NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data Subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  // Write PCM samples
  for (let i = 0; i < samples.length; i++) {
    const val = samples[i] ?? 0;
    buffer.writeInt16LE(val, 44 + i * 2);
  }

  return buffer;
}

export const soundboardService = new SoundboardService();
