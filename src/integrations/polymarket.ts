// Polymarket CLOB API — no auth required for read operations
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

export interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  endDate: string;
  active: boolean;
  volume: number;
  liquidity: number;
  outcomes: string[];       // ['Yes', 'No'] or multi-outcome
  outcomePrices: number[];  // probability 0-1 per outcome
  url: string;
}

export async function searchPolymarkets(query: string, limit = 5): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      active: 'true',
      closed: 'false',
      limit: String(limit),
      order: 'volume',
      ascending: 'false',
    });
    const res = await fetch(`${GAMMA_API}/events?${params}`);
    if (!res.ok) return [];
    const events: any[] = await res.json();

    // Extract one representative market per event
    const markets: PolymarketMarket[] = [];
    for (const event of events) {
      const eventMarkets: any[] = event.markets || [];
      const best = eventMarkets[0];
      if (!best) continue;
      const normalized = normalizeMarket({ ...best, events: [event] });
      if (normalized) markets.push(normalized);
      if (markets.length >= limit) break;
    }
    return markets;
  } catch {
    return [];
  }
}

export async function getPolymarketById(conditionId: string): Promise<PolymarketMarket | null> {
  try {
    const res = await fetch(`${GAMMA_API}/markets/${conditionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeMarket(data);
  } catch {
    return null;
  }
}

export async function getTrendingPolymarkets(limit = 5): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(limit),
      order: 'volume24hr',
      ascending: 'false',
    });
    const res = await fetch(`${GAMMA_API}/events?${params}`);
    if (!res.ok) return [];
    const events: any[] = await res.json();

    const markets: PolymarketMarket[] = [];
    for (const event of events) {
      const best = (event.markets || [])[0];
      if (!best) continue;
      const normalized = normalizeMarket({ ...best, events: [event] });
      if (normalized) markets.push(normalized);
      if (markets.length >= limit) break;
    }
    return markets;
  } catch {
    return [];
  }
}

function normalizeMarket(m: any): PolymarketMarket | null {
  if (!m?.question) return null;

  let outcomes: string[] = [];
  let outcomePrices: number[] = [];

  try {
    outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes || ['Yes', 'No'];
    const rawPrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices || [];
    outcomePrices = rawPrices.map((p: any) => parseFloat(p));
  } catch {
    outcomes = ['Yes', 'No'];
    outcomePrices = [0.5, 0.5];
  }

  // Use event slug for correct URL, fall back to market slug
  const eventSlug = m.events?.[0]?.slug || m.slug || m.id;

  return {
    id: m.conditionId || m.id,
    question: m.question,
    description: m.description || '',
    endDate: m.endDate || m.endDateIso || '',
    active: m.active ?? true,
    volume: parseFloat(m.volume || '0'),
    liquidity: parseFloat(m.liquidity || '0'),
    outcomes,
    outcomePrices,
    url: `https://polymarket.com/event/${eventSlug}`,
  };
}

export function formatPolymarket(m: PolymarketMarket): string {
  const priceStr = m.outcomes
    .map((o, i) => `${o}: ${Math.round((m.outcomePrices[i] || 0) * 100)}%`)
    .join(' | ');
  const vol = m.volume > 1000 ? `$${(m.volume / 1000).toFixed(0)}k` : `$${m.volume.toFixed(0)}`;
  const end = m.endDate ? new Date(m.endDate).toLocaleDateString() : 'TBD';
  return `*${m.question}*\n${priceStr}\nVolume: ${vol} | Ends: ${end}\n${m.url}`;
}
