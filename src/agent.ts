import OpenAI from 'openai';
import { config } from './config';
import { getOrCreateWallet, getBalance, getBettingBalance, deductBettingBalance, creditBettingBalance } from './wallet';
import { MarketService } from './market';
import { prisma } from './db';
import { getCryptoPrice } from './oracles/crypto';
import { searchPolymarkets, getTrendingPolymarkets, getPolymarketsByCategory, getPolymarketsEndingSoon, formatPolymarket, PolymarketMarket } from './integrations/polymarket';
import { sendTelegramMessageWithKeyboard } from './telegram';

// Pending bet state: waiting for amount after user clicked YES/NO on a market
export const pendingBets = new Map<string, { question: string; side: 'yes' | 'no' }>();

// Registry: short hash → full question text (for callback_data size limit workaround)
export const questionRegistry = new Map<string, string>();
export function registerQuestion(q: string): string {
  let hash = 0;
  for (let i = 0; i < q.length; i++) hash = (hash * 31 + q.charCodeAt(i)) & 0xfffffff;
  const key = hash.toString(36);
  questionRegistry.set(key, q);
  return key;
}

const client = new OpenAI({
  apiKey: config.groq.apiKey || config.openai.apiKey,
  baseURL: config.groq.apiKey ? 'https://api.groq.com/openai/v1' : undefined,
});
const model = config.groq.apiKey ? 'llama-3.3-70b-versatile' : 'gpt-4o';

const marketService = new MarketService(config.celo.contractAddress as `0x${string}`);

const LEVERAGE_OPTIONS = [1, 2, 3, 5];

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_market',
      description: 'Create a prediction market. For fast markets use durationMins: 5, 60, or 1440.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          resolution_date: { type: 'string', description: 'ISO date — ignored if durationMins is set' },
          oracle_type: { type: 'string', enum: ['crypto', 'sports'] },
          oracle_data: { type: 'object', description: '{ coin, targetPrice, direction } or { matchId, team1, team2 }' },
          durationMins: { type: 'number', description: '5 = 5-min, 60 = 1-hour, 1440 = same-day. Omit for custom date.' },
        },
        required: ['question', 'oracle_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_bet',
      description: 'Place a bet on a prediction market. Pass the market ID if known, or the full market question if the user wants to bet on a topic (a local market will be created automatically).',
      parameters: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market UUID, or the full question text if no local market exists yet' },
          side: { type: 'string', enum: ['yes', 'no'] },
          amount: { type: 'number', description: 'Amount in CELO' },
          leverage: { type: 'number', enum: [1, 2, 3, 5], description: 'Leverage multiplier. Default 1x.' },
        },
        required: ['market_id', 'side', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_markets',
      description: 'List active prediction markets',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio',
      description: 'Get user portfolio and positions',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Get user CELO balance and wallet address',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_deposit_info',
      description: 'Get deposit instructions and wallet address',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_insights',
      description: 'Get AI analysis and price sentiment for a crypto coin',
      parameters: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'e.g. BTC, ETH, SOL' },
        },
        required: ['coin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'debate_mode',
      description: 'Challenge a user opinion with an AI counterpoint to spark debate',
      parameters: {
        type: 'object',
        properties: {
          opinion: { type: 'string', description: 'The user opinion to debate' },
        },
        required: ['opinion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_challenge',
      description: 'Get or show the user daily prediction challenge progress',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_markets',
      description: 'Search for prediction markets by topic across local markets and Polymarket. Use this whenever a user asks to find, browse, or look up markets on any topic.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search topic, e.g. "bitcoin", "US election", "Champions League". Use "trending" to get top markets.' },
        },
        required: ['query'],
      },
    },
  },
];

const systemPrompt = `You are Orba — a sharp, friendly AI prediction markets assistant on Telegram. You help users find markets, place bets, and track positions using natural conversation.

INTENT MAPPING (always resolve to the right action):

SEARCH / BROWSE:
- "any markets on X", "is there a market for X", "find X markets", "what's the market on X", "show me X" → search_markets(query=X)
- "what can I bet on", "show me markets", "what's trending", "what's hot" → get_markets or search_markets(query=trending)
- "Polymarket X", "real money markets on X" → search_markets(query=X)

BET / TRADE:
- "bet $N on X", "put $N on YES/NO", "I'll take YES on market N", "#N YES $N" → place_bet
- If the user wants to bet on a Polymarket result, pass the FULL market question as market_id — a local market will be auto-created
- "I think X will happen" → offer to place a bet or create a market
- "double down", "2x", "3x", "5x" → place_bet with leverage

CREATE:
- "create a market on X", "make a market", "start a bet on X" → create_market
- "will X happen by [date]?" → create_market with that question

PORTFOLIO / BALANCE:
- "my bets", "my positions", "how am I doing", "portfolio" → get_portfolio
- "my balance", "how much do I have", "wallet" → get_balance
- "deposit", "get CELO", "fund my wallet" → get_deposit_info

INSIGHTS / DEBATE:
- "what do you think about X", "analyse X", "X prediction", "is X a good bet" → get_market_insights
- "I think X is wrong / overrated / going to crash" → debate_mode

MISC:
- "daily challenge", "what's today's challenge" → get_daily_challenge
- "help", "what can you do", "show markets", "browse" → tell user to tap /markets for the category browser

RESPONSE RULES:
- Be concise. No filler. No "Great question!" or "Sure thing!".
- When showing markets, include odds and a Polymarket link if available.
- Assume intent and act — only ask for clarification if truly ambiguous.
- For leveraged bets (>1x), always mention liquidation risk in one line.
- Amounts: CELO for local markets, USD for Polymarket.
- When a user shares a strong opinion (crypto/sports/politics), offer to create a market or debate it.
- Use market number aliases (#1, #2) when listing markets so users can bet easily.`;

const userContext = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

async function executeFunction(name: string, args: any, phoneNumber: string, chatId?: number): Promise<string> {
  const { userId, address } = await getOrCreateWallet(phoneNumber);

  switch (name) {
    case 'create_market': {
      let resolutionTime: Date;
      if (args.durationMins) {
        resolutionTime = new Date(Date.now() + args.durationMins * 60_000);
      } else {
        resolutionTime = new Date(args.resolution_date);
      }

      const market = await prisma.market.create({
        data: {
          question: args.question,
          resolutionTime,
          oracleType: args.oracle_type,
          oracleData: args.oracle_data || {},
          creatorId: userId,
          durationMins: args.durationMins || null,
        },
      });

      const duration = args.durationMins
        ? args.durationMins < 60 ? `${args.durationMins}min` : args.durationMins === 60 ? '1hr' : 'same-day'
        : resolutionTime.toLocaleDateString();

      return `Market created!\n\n"${market.question}"\nID: \`${market.id}\`\nResolves in: ${duration}`;
    }

    case 'place_bet': {
      let market = await prisma.market.findUnique({ where: { id: args.market_id } });

      // If not found by ID, try matching by question text (AI may pass question instead of ID)
      if (!market) {
        market = await prisma.market.findFirst({
          where: {
            resolved: false,
            question: { contains: args.market_id, mode: 'insensitive' },
          },
        });
      }

      // If still not found, auto-create a local market from the question text
      if (!market) {
        const question = args.market_id.length > 10 && args.market_id.includes(' ')
          ? args.market_id
          : null;
        if (!question) return 'Market not found. Try searching first with "find markets on [topic]", then bet using the market ID.';

        market = await prisma.market.create({
          data: {
            question,
            resolutionTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            oracleType: 'manual',
            oracleData: {},
            creatorId: userId,
          },
        });
      }
      if (market.resolved) return 'Market already resolved';

      const leverage = LEVERAGE_OPTIONS.includes(args.leverage) ? args.leverage : 1;
      const effectiveAmount = args.amount * leverage;

      const balance = await getBettingBalance(userId);
      if (balance < args.amount) return `Insufficient balance. You have ${balance.toFixed(2)} CELO`;

      // Calculate liquidation price for leveraged crypto bets
      let liquidationPrice: number | null = null;
      if (leverage > 1 && market.oracleType === 'crypto') {
        const oracleData = market.oracleData as any;
        const priceData = await getCryptoPrice(oracleData.coin);
        if (priceData) {
          const buffer = priceData.price / leverage;
          liquidationPrice = args.side === 'yes'
            ? priceData.price - buffer
            : priceData.price + buffer;
        }
      }

      await prisma.position.upsert({
        where: { userId_marketId: { userId, marketId: market.id } },
        create: {
          userId,
          marketId: market.id,
          yesShares: args.side === 'yes' ? BigInt(Math.round(effectiveAmount * 1e18)) : 0n,
          noShares: args.side === 'no' ? BigInt(Math.round(effectiveAmount * 1e18)) : 0n,
          leverage,
          liquidationPrice,
        },
        update: {
          ...(args.side === 'yes'
            ? { yesShares: { increment: BigInt(Math.round(effectiveAmount * 1e18)) } }
            : { noShares: { increment: BigInt(Math.round(effectiveAmount * 1e18)) } }),
          leverage,
          liquidationPrice,
        },
      });

      await prisma.trade.create({
        data: {
          userId,
          marketId: market.id,
          outcome: args.side === 'yes' ? 1 : 0,
          shares: BigInt(Math.round(effectiveAmount * 1e18)),
          cost: BigInt(Math.round(args.amount * 1e18)),
          leverage,
        },
      });

      await deductBettingBalance(userId, args.amount);

      let reply = `Bet placed! $${args.amount} on ${args.side.toUpperCase()}`;
      if (leverage > 1) {
        reply += ` (${leverage}x leverage → $${effectiveAmount} exposure)`;
        if (liquidationPrice) reply += `\nLiquidation price: $${liquidationPrice.toFixed(2)}`;
      }
      return reply;
    }

    case 'get_markets': {
      const markets = await prisma.market.findMany({
        where: { resolved: false },
        orderBy: { resolutionTime: 'asc' },
        take: 10,
      });
      if (!markets.length) return 'No active markets. Create one!';

      return markets.map((m, i) => {
        const mins = m.durationMins;
        const label = mins
          ? mins < 60 ? `${mins}min` : mins === 60 ? '1hr' : 'same-day'
          : m.resolutionTime.toLocaleDateString();
        return `${i + 1}. "${m.question}" [${label}]\n   ID: \`${m.id}\``;
      }).join('\n\n');
    }

    case 'get_portfolio': {
      const positions = await prisma.position.findMany({
        where: { userId },
        include: { market: true },
      });
      if (!positions.length) return 'No positions yet.';

      return positions.map(p => {
        const side = p.yesShares > 0n ? 'YES' : 'NO';
        const lev = p.leverage > 1 ? ` ${p.leverage}x` : '';
        const liq = p.liquidationPrice ? ` | Liq: $${p.liquidationPrice.toFixed(0)}` : '';
        const status = p.liquidated ? ' [LIQUIDATED]' : '';
        return `"${p.market.question}"\n   ${side}${lev}${liq}${status}`;
      }).join('\n\n');
    }

    case 'get_balance': {
      const bettingBal = await getBettingBalance(userId);
      return `Betting Balance: ${bettingBal.toFixed(2)} CELO\nWallet: \`${address}\``;
    }

    case 'get_deposit_info': {
      return `Your wallet: \`${address}\`\n\nGet testnet CELO:\n1. Faucet: https://faucet.celo.org/celo-sepolia\n2. Send CELO to your wallet above\n\nNetwork: Celo Sepolia`;
    }

    case 'get_market_insights': {
      const priceData = await getCryptoPrice(args.coin);
      if (!priceData) return `Couldn't fetch live price for ${args.coin.toUpperCase()} right now. Try again in a moment.`;

      try {
        const res = await client.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a crypto market analyst. Give a sharp 3-sentence analysis: current sentiment, key risk, and a directional lean. Be direct, no fluff.',
            },
            {
              role: 'user',
              content: `${args.coin.toUpperCase()} is currently at $${priceData.price}. What's your read?`,
            },
          ],
          max_tokens: 150,
        });
        return `${args.coin.toUpperCase()} — $${priceData.price}\n\n${res.choices[0].message.content}`;
      } catch {
        return `${args.coin.toUpperCase()} — $${priceData.price}\n\nAI analysis unavailable right now.`;
      }
    }

    case 'debate_mode': {
      const res = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a sharp contrarian analyst. Challenge the user\'s opinion with a strong counterpoint in 2-3 sentences. End with a question that challenges their conviction. Be provocative but factual.',
          },
          { role: 'user', content: args.opinion },
        ],
        max_tokens: 150,
      });

      return `Counterpoint:\n\n${res.choices[0].message.content}\n\nWant to put money on it? I can create a market.`;
    }

    case 'get_daily_challenge': {
      const today = new Date().toISOString().slice(0, 10);
      const challenge = await prisma.dailyChallenge.upsert({
        where: { userId_date: { userId, date: today } },
        create: { userId, date: today },
        update: {},
      });

      const status = challenge.done ? 'Completed!' : `${challenge.completed}/${challenge.target}`;
      return `Daily Challenge — ${today}\n\nPredict ${challenge.target} markets correctly today\nProgress: ${status}${challenge.done && !challenge.rewardPaid ? '\n\nReward pending — contact support to claim.' : ''}`;
    }

    case 'search_markets': {
      const results: string[] = [];
      const isTrendingQuery = /^trending$/i.test(args.query.trim());

      // 1. Search local DB
      const words = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
      const localMarkets = await prisma.market.findMany({
        where: {
          resolved: false,
          OR: words.map((w: string) => ({ question: { contains: w, mode: 'insensitive' } })),
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      if (localMarkets.length) {
        results.push('*Local Markets:*\n' + localMarkets.map((m, i) => {
          const label = m.durationMins
            ? m.durationMins < 60 ? `${m.durationMins}min` : m.durationMins === 60 ? '1hr' : 'same-day'
            : m.resolutionTime.toLocaleDateString();
          return `${i + 1}. "${m.question}" [${label}]\n   ID: \`${m.id}\``;
        }).join('\n\n'));
      }

      // 2. Search Polymarket (with fallback)
      try {
        const category = detectCategory(args.query);
        const polyMarkets = isTrendingQuery
          ? await getTrendingPolymarkets(5)
          : category
            ? await getPolymarketsByCategory(category, 5)
            : await searchPolymarkets(args.query, 5);

        if (polyMarkets.length) {
          if (chatId) {
            // Send each result as a separate message with YES/NO buttons
            for (const m of polyMarkets) {
              const priceStr = m.outcomes.map((o, i) => `${o}: ${Math.round((m.outcomePrices[i] || 0) * 100)}%`).join(' | ');
              const vol = m.volume > 1000 ? `$${(m.volume / 1000).toFixed(0)}k` : `$${m.volume.toFixed(0)}`;
              const end = m.endDate ? new Date(m.endDate).toLocaleDateString() : 'TBD';
              const text = `*${m.question}*\n${priceStr}\nVolume: ${vol} | Ends: ${end}\n${m.url}`;
              const q = registerQuestion(m.question);
              await sendTelegramMessageWithKeyboard(chatId, text, [[
                { text: '✅ Bet YES', callback_data: `bet:yes:${q}` },
                { text: '❌ Bet NO', callback_data: `bet:no:${q}` },
              ]]);
            }
            results.push('_Tap YES or NO on any market above to place a bet._');
          } else {
            results.push(
              '*Polymarket (real-money, view only):*\n' +
              polyMarkets.map((m, i) => `${i + 1}. ${formatPolymarket(m)}`).join('\n\n') +
              '\n\n_Want to bet? Say "bet $N YES on [question]"_'
            );
          }
        }
      } catch {
        // Polymarket unavailable — skip silently
      }

      if (!results.length) return `No markets found for "${args.query}". Want to create one?`;
      return results.join('\n\n---\n\n');
    }

    default:
      return 'Unknown action';
  }
}

// Map natural language to Polymarket tag slugs
const CATEGORY_MAP: Record<string, string> = {
  politics: 'politics', political: 'politics', election: 'politics', elections: 'politics', trump: 'politics', government: 'politics',
  sports: 'sports', sport: 'sports', football: 'sports', soccer: 'sports', basketball: 'sports', nba: 'sports',
  nfl: 'sports', baseball: 'sports', tennis: 'sports', mls: 'sports', fifa: 'sports', lakers: 'sports',
  warriors: 'sports', nhl: 'sports', ufc: 'sports', boxing: 'sports',
  crypto: 'crypto', bitcoin: 'crypto', btc: 'crypto', eth: 'crypto', ethereum: 'crypto', solana: 'crypto',
  defi: 'crypto', web3: 'crypto', blockchain: 'crypto',
  'pop-culture': 'pop-culture', popculture: 'pop-culture', celebrity: 'pop-culture', music: 'pop-culture',
  entertainment: 'pop-culture', movies: 'pop-culture', tv: 'pop-culture', oscars: 'pop-culture',
  science: 'science', tech: 'technology', technology: 'technology', ai: 'technology',
};

function detectCategory(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, slug] of Object.entries(CATEGORY_MAP)) {
    if (new RegExp(`\\b${keyword}\\b`).test(lower)) return slug;
  }
  return null;
}

// Patterns that should always trigger a market search
const SEARCH_TRIGGERS = /\b(find|search|show|any|look for|is there|are there|what.*market|market.*on|markets.*about|markets.*for|bet on|predict|trending|popular|hot|what can i bet|what's (hot|trending|available))\b/i;

function extractSearchQuery(text: string): string | null {
  return text
    .replace(/\b(is there|are there|find|search|show me|any|look for|what('s| is| are)?( the)?|markets?( on| about| for)?|can i bet on|is there a market|trending|popular|available|now|right now|currently|today|\bon\b|\babout\b|\bfor\b)\b/gi, '')
    .replace(/[?!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

export async function handleMessage(phoneNumber: string, text: string, chatId?: number): Promise<string> {
  let context = userContext.get(phoneNumber) || [];
  context.push({ role: 'user', content: text });
  if (context.length > 10) context = context.slice(-10);
  userContext.set(phoneNumber, context);

  // Detect search intent early and force the right tool
  const isTrending = /\b(trending|popular|hot|top)\b/i.test(text);
  const isSearch = SEARCH_TRIGGERS.test(text) && !/\b(create|make|start|place|bet|buy|deposit|balance|portfolio)\b/i.test(text);
  const forcedTool = isSearch
    ? { type: 'function' as const, function: { name: 'search_markets' } }
    : undefined;

  const messagesForAI = isSearch
    ? [
        { role: 'system' as const, content: systemPrompt },
        ...context.slice(0, -1),
        {
          role: 'user' as const,
          content: isTrending
            ? 'Search markets for: trending'
            : `Search markets for: ${extractSearchQuery(text) || text}`,
        },
      ]
    : [{ role: 'system' as const, content: systemPrompt }, ...context];

  try {
    const response = await client.chat.completions.create({
      model,
      messages: messagesForAI,
      tools,
      tool_choice: forcedTool ?? 'auto',
    });

    const message = response.choices[0].message;

    if (message.tool_calls?.length) {
      const results: string[] = [];
      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        results.push(await executeFunction(call.function.name, args, phoneNumber, chatId));
      }
      const reply = results.join('\n\n');
      context.push({ role: 'assistant', content: reply });
      userContext.set(phoneNumber, context);
      return reply;
    }

    const reply = message.content || "I didn't understand that. Try asking about markets or your balance!";
    context.push({ role: 'assistant', content: reply });
    userContext.set(phoneNumber, context);
    return reply;
  } catch (err) {
    console.error('AI error:', err);
    return "Sorry, I'm having trouble right now. Please try again.";
  }
}
