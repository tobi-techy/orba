import { config } from '../config';

interface CryptoPrice {
  coin: string;
  price: number;
  timestamp: Date;
}

const COIN_IDS: Record<string, string> = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  celo: 'celo',
  sol: 'solana', solana: 'solana',
  matic: 'matic-network', polygon: 'matic-network',
};

export async function getCryptoPrice(coin: string): Promise<CryptoPrice | null> {
  const coinId = COIN_IDS[coin.toLowerCase()];
  if (!coinId) return null;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    const res = await fetch(url, {
      headers: config.oracles.coinGeckoKey 
        ? { 'x-cg-demo-api-key': config.oracles.coinGeckoKey }
        : {},
    });
    const data = await res.json();
    return {
      coin: coinId,
      price: data[coinId]?.usd ?? 0,
      timestamp: new Date(),
    };
  } catch {
    return null;
  }
}

export interface CryptoMarketData {
  coin: string;
  targetPrice: number;
  direction: 'above' | 'below';
}

export function resolveCryptoMarket(currentPrice: number, data: CryptoMarketData): boolean {
  if (data.direction === 'above') {
    return currentPrice >= data.targetPrice;
  }
  return currentPrice <= data.targetPrice;
}
