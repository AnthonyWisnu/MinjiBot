import { AppUserError } from "../../errors/appUserError";
import { BoundedTtlCache } from "../../utils/ttlCache";

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3/simple/price";
const USER_AGENT =
  "MinjiBot/2.0 (https://github.com/AnthonyWisnu/MinjiBot; non-commercial WhatsApp bot)";
const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export interface LiveCryptoTicker {
  id: string;
  symbol: string;
  name: string;
  idr: number;
  usd: number;
  change24h: number;
}

interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
}

export const POPULAR_COINS: readonly CoinMeta[] = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "the-open-network", symbol: "TON", name: "Toncoin" },
  { id: "pepe", symbol: "PEPE", name: "Pepe" },
] as const;

const COIN_ALIASES: Record<string, CoinMeta> = {
  btc: { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  bitcoin: { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  eth: { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  ethereum: { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  sol: { id: "solana", symbol: "SOL", name: "Solana" },
  solana: { id: "solana", symbol: "SOL", name: "Solana" },
  bnb: { id: "binancecoin", symbol: "BNB", name: "BNB" },
  binancecoin: { id: "binancecoin", symbol: "BNB", name: "BNB" },
  xrp: { id: "ripple", symbol: "XRP", name: "XRP" },
  ripple: { id: "ripple", symbol: "XRP", name: "XRP" },
  doge: { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  dogecoin: { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  ton: { id: "the-open-network", symbol: "TON", name: "Toncoin" },
  toncoin: { id: "the-open-network", symbol: "TON", name: "Toncoin" },
  pepe: { id: "pepe", symbol: "PEPE", name: "Pepe" },
  ada: { id: "cardano", symbol: "ADA", name: "Cardano" },
  cardano: { id: "cardano", symbol: "ADA", name: "Cardano" },
  usdt: { id: "tether", symbol: "USDT", name: "Tether" },
  tether: { id: "tether", symbol: "USDT", name: "Tether" },
  usdc: { id: "usd-coin", symbol: "USDC", name: "USD Coin" },
  sui: { id: "sui", symbol: "SUI", name: "Sui" },
  avax: { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  link: { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  shib: { id: "shiba-inu", symbol: "SHIB", name: "Shiba Inu" },
  trx: { id: "tron", symbol: "TRX", name: "TRON" },
  ltc: { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  dot: { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  matic: { id: "matic-network", symbol: "POL", name: "Polygon" },
  pol: { id: "polygon-ecosystem-token", symbol: "POL", name: "Polygon" },
};

type FetchFn = typeof fetch;

interface CoinGeckoPriceEntry {
  idr?: number;
  usd?: number;
  usd_24h_change?: number;
}

export class LiveCryptoService {
  private readonly cache = new BoundedTtlCache<LiveCryptoTicker[]>(40, CACHE_TTL_MS);

  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async getPrices(rawQuery?: string): Promise<LiveCryptoTicker[]> {
    const query = (rawQuery ?? "").trim().toLowerCase();
    const metas: CoinMeta[] = [];

    if (!query) {
      metas.push(...POPULAR_COINS);
    } else {
      const cleaned = query.replace(/[^a-z0-9-]/g, "");
      if (!cleaned) {
        throw new AppUserError("Masukkan nama atau kode koin yang valid. Contoh: .hargakripto btc");
      }
      const mapped = COIN_ALIASES[cleaned];
      if (mapped) {
        metas.push(mapped);
      } else {
        metas.push({
          id: cleaned,
          symbol: cleaned.toUpperCase().slice(0, 8),
          name: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
        });
      }
    }

    const cacheKey = metas.map((m) => m.id).join(",");
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${COINGECKO_API_BASE}?ids=${encodeURIComponent(cacheKey)}&vs_currencies=idr,usd&include_24hr_change=true`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await this.fetchFn(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new AppUserError(
          "Server harga kripto sedang ramai. Tunggu sekitar 30 detik lalu coba lagi ya.",
        );
      }
      if (!response.ok) {
        throw new AppUserError("Gagal mengambil harga kripto live dari CoinGecko saat ini.");
      }

      const data = (await response.json()) as Record<string, CoinGeckoPriceEntry | undefined>;
      const results: LiveCryptoTicker[] = [];
      for (const meta of metas) {
        const entry = data[meta.id];
        if (entry && typeof entry.usd === "number" && typeof entry.idr === "number") {
          results.push({
            id: meta.id,
            symbol: meta.symbol,
            name: meta.name,
            idr: entry.idr,
            usd: entry.usd,
            change24h: typeof entry.usd_24h_change === "number" ? entry.usd_24h_change : 0,
          });
        }
      }

      if (results.length === 0) {
        throw new AppUserError(
          `Koin "${rawQuery ?? ""}" tidak ditemukan di CoinGecko. Coba: btc, eth, sol, bnb, xrp, doge, ton, pepe, ada, sui.`,
        );
      }

      this.cache.set(cacheKey, results);
      return results;
    } catch (error: unknown) {
      if (error instanceof AppUserError) {
        throw error;
      }
      throw new AppUserError("Koneksi ke layanan harga kripto live sedang lambat. Coba lagi ya.");
    } finally {
      clearTimeout(timer);
    }
  }
}

export const liveCryptoService = new LiveCryptoService();
