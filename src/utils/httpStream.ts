import { AppUserError } from "../errors/appUserError";
import { safeFetchExternal, type SafeFetchOptions } from "./urlValidator";

export interface FetchBufferOptions extends Omit<SafeFetchOptions, "signal"> {
  maxBytes: number;
  timeoutMs?: number;
}

export interface FetchBufferResult {
  buffer: Buffer;
  contentType?: string;
  contentLength?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

/**
 * Mengunduh konten HTTP sebagai Buffer dengan pembatasan ukuran ketat (streaming-safe):
 * 1. Memeriksa header Content-Length sebelum membaca body (early abort)
 * 2. Menghitung akumulasi chunk stream secara real-time dan langsung memutus koneksi
 *    bila ukuran byte melebihi batas maxBytes tanpa memuat seluruhnya ke RAM
 * 3. Terintegrasi dengan safeFetchExternal untuk proteksi SSRF & anti-private-IP
 */
function formatFriendlySizeLimitMessage(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  const label = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return `Maaf, ukuran file ini terlalu besar (lebih dari ${label} MB), jadi belum bisa dikirim lewat WhatsApp. Coba pilih video atau file yang lebih kecil ya!`;
}

export async function fetchBufferWithLimit(
  url: string,
  options: FetchBufferOptions,
): Promise<FetchBufferResult> {
  const { maxBytes, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("Proses unduhan terlalu lama, silakan coba lagi beberapa saat."));
  }, timeoutMs);

  try {
    const response = await safeFetchExternal(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP fetch error: ${String(response.status)} ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const parsedLength = Number(contentLengthHeader);
      if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
        throw new AppUserError(formatFriendlySizeLimitMessage(maxBytes));
      }
    }

    const contentType = response.headers.get("content-type") ?? undefined;

    // Jika response body tidak tersedia sebagai web stream, fallback ke arrayBuffer dengan cek ukuran
    if (!response.body) {
      const arrayBuf = await response.arrayBuffer();
      if (arrayBuf.byteLength > maxBytes) {
        throw new AppUserError(formatFriendlySizeLimitMessage(maxBytes));
      }
      return {
        buffer: Buffer.from(arrayBuf),
        contentType,
        contentLength: arrayBuf.byteLength,
      };
    }

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    let chunk = await reader.read();
    while (!chunk.done) {
      const val = chunk.value;
      receivedBytes += val.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        controller.abort();
        throw new AppUserError(formatFriendlySizeLimitMessage(maxBytes));
      }
      chunks.push(val);
      chunk = await reader.read();
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType,
      contentLength: receivedBytes,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
