import OpenAI from 'openai';
import { config } from './config';
import { getOrCreateWallet, getBalance } from './wallet';
import { MarketService } from './market';
import { prisma } from './db';
import { getCryptoPrice } from './oracles/crypto';
import { searchPolymarkets, getTrendingPolymarkets, formatPolymarket } from './integrations/polymarket';

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
      description: 'Place a bet on a market, optionally with leverage (2x/3x/5x).',
      parameters: {
        type: 'object',
        properties: {
          market_id: { type: 'string' },
          side: { type: 'string', enum: ['yes', 'no'] },
          amount: { type: 'number', description: 'Amount in cUSD' },
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
      description: 'Get user cUSD balance and wallet address',
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
          query: { type: 'string', description: 'Search topic, e.g. "bitcoin", "US election", "Champions League"' },
          trending: { type: 'boolean', description: 'If true, return trending markets instead of searching by query' },
        },
        required: ['query'],
      },
    },
  },
];

const systemPrompt = `You are Orba, an AI prediction market assistant on Telegram. You understand natural conversational English and translate it into actions.

INTENT RECOGNITION — always map user messages to the right action:
- "what markets are there", "show me markets", "what can I bet on" → get_markets or search_markets(trending=true)
- "find markets about X", "any markets on X", "search X", "what's the market on X" → search_markets(query=X)
- "bet on X", "put money on X", "I think X will win" → place_bet (ask for market ID if unclear)
- "how much do I have", "my balance", "wallet" → get_balance
- "create a market", "make a bet on X", "start a market" → create_market
- "what do you think about X", "analyse X", "X price prediction" → get_market_insights
- "I think X is wrong / overrated / going to fail" → debate_mode
- "my bets", "my positions", "how am I doing" → get_portfolio
- "daily challenge", "challenge", "tasks" → get_daily_challenge

CAPABILITIES:
- Create fast markets (5-min, 1-hour, same-day) or custom date markets on crypto/sports
- Place leveraged bets (1x/2x/3x/5x) — always mention liquidation risk for leverage > 1x
- Search local markets AND Polymarket (real-money prediction markets) for any topic
- AI market insights, debate mode, daily challenges

RESPONSE STYLE:
- Be concise and direct. No filler phrases.
- When showing search results, always include the odds/prices and a link if from Polymarket.
- When a user's intent is ambiguous, make a reasonable assumption and act — don't ask for clarification unless truly necessary.
- Format amounts in cUSD for local markets, USD for Polymarket.`;

For fast crypto markets, suggest "Will BTC move +1% in 30 minutes?" style questions.
When users mention leverage, always confirm the multiplier and explain liquidation risk briefly.
When users share strong opinions about crypto/sports, offer to debate or create a market from it.`;

const userContext = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

async function executeFunction(name: string, args: any, phoneNumber: string): Promise<string> {
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
      const market = await prisma.market.findUnique({ where: { id: args.market_id } });
      if (!market) return 'Market not found';
      if (market.resolved) return 'Market already resolved';

      const leverage = LEVERAGE_OPTIONS.includes(args.leverage) ? args.leverage : 1;
      const effectiveAmount = args.amount * leverage;

      const balance = await getBalance(address);
      if (parseFloat(balance) < args.amount) return `Insufficient balance. You have ${balance} cUSD`;

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
        where: { userId_marketId: { userId, marketId: args.market_id } },
        create: {
          userId,
          marketId: args.market_id,
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
          marketId: args.market_id,
          outcome: args.side === 'yes' ? 1 : 0,
          shares: BigInt(Math.round(effectiveAmount * 1e18)),
          cost: BigInt(Math.round(args.amount * 1e18)),
          leverage,
        },
      });

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
      const balance = await getBalance(address);
      return `Balance: ${balance} cUSD\nWallet: \`${address}\``;
    }

    case 'get_deposit_info': {
      return `Your wallet: \`${address}\`\n\nGet testnet cUSD:\n1. Faucet: https://faucet.celo.org/celo-sepolia\n2. Send cUSD to your wallet above\n\nNetwork: Celo Sepolia`;
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
        const polyMarkets = args.trending
          ? await getTrendingPolymarkets(5)
          : await searchPolymarkets(args.query, 5);

        if (polyMarkets.length) {
          results.push('*Polymarket:*\n' + polyMarkets.map((m, i) => `${i + 1}. ${formatPolymarket(m)}`).join('\n\n'));
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

// Patterns that should always trigger a market search
const SEARCH_TRIGGERS = /\b(find|search|show|any|look for|what.*market|market.*on|markets.*about|bet on|predict|trending|popular)\b/i;

function extractSearchQuery(text: string): string | null {
  // Strip filler words to get the core topic
  return text
    .replace(/\b(find|search|show me|any|look for|what('s| is| are)( the)?|markets?(on|about|for)?|can i bet on|is there a market|trending|popular)\b/gi, '')
    .replace(/[?!.,]/g, '')
    .trim() || null;
}

export async function handleMessage(phoneNumber: string, text: string): Promise<string> {
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

  // If it's clearly a search, inject the extracted query so the AI doesn't have to guess
  const messagesForAI = isSearch
    ? [
        { role: 'system' as const, content: systemPrompt },
        ...context.slice(0, -1),
        {
          role: 'user' as const,
          content: isTrending
            ? 'Show me trending markets'
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
        results.push(await executeFunction(call.function.name, args, phoneNumber));
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
