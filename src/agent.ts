import OpenAI from 'openai';
import { config } from './config';
import { getOrCreateWallet, getBalance } from './wallet';
import { MarketService } from './market';
import { prisma } from './db';

// Use Groq (free) or OpenAI
const client = new OpenAI({
  apiKey: config.groq.apiKey || config.openai.apiKey,
  baseURL: config.groq.apiKey ? 'https://api.groq.com/openai/v1' : undefined,
});
const model = config.groq.apiKey ? 'llama-3.3-70b-versatile' : 'gpt-4o';

const marketService = new MarketService(config.celo.contractAddress as `0x${string}`);

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_market',
      description: 'Create a new prediction market',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The prediction question' },
          resolution_date: { type: 'string', description: 'ISO date when market resolves' },
          oracle_type: { type: 'string', enum: ['crypto', 'sports'], description: 'Type of oracle for resolution' },
          oracle_data: { type: 'object', description: 'Oracle-specific data (coin/price for crypto, teams for sports)' },
        },
        required: ['question', 'resolution_date', 'oracle_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_bet',
      description: 'Place a bet on a market',
      parameters: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID to bet on' },
          side: { type: 'string', enum: ['yes', 'no'], description: 'YES or NO' },
          amount: { type: 'number', description: 'Amount in cUSD' },
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
      description: 'Get deposit instructions and wallet address for funding',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const systemPrompt = `You are Orba, a friendly AI prediction market assistant on Telegram/WhatsApp. You help users:
- Create prediction markets on crypto prices or sports outcomes
- Place bets (YES/NO) on markets using cUSD stablecoins on Celo
- Check their portfolio, balances, and deposit instructions

Be concise and conversational. Use emojis. Format amounts in cUSD.
When users ask how to deposit or fund their wallet, use get_deposit_info.
When users want to bet, confirm the market, side, and amount before executing.
For crypto markets, extract the coin, target price, and direction.
For sports markets, extract the teams and match details.`;

// Simple in-memory context (last 5 messages per user)
const userContext = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

async function executeFunction(name: string, args: any, phoneNumber: string) {
  const { userId, address, account } = await getOrCreateWallet(phoneNumber);

  switch (name) {
    case 'create_market': {
      const market = await marketService.createMarket(
        args.question,
        new Date(args.resolution_date),
        args.oracle_type,
        args.oracle_data || {},
        userId
      );
      return `✅ Market created!\n\n"${market.question}"\n\nMarket ID: ${market.id}\nResolves: ${market.resolutionTime.toLocaleDateString()}`;
    }

    case 'place_bet': {
      const market = await prisma.market.findUnique({ where: { id: args.market_id } });
      if (!market) return '❌ Market not found';
      if (market.resolved) return '❌ Market already resolved';
      if (args.amount <= 0 || args.amount > 10000) return '❌ Bet amount must be between $0.01 and $10,000';
      
      const balance = await getBalance(address);
      if (parseFloat(balance) < args.amount) return `❌ Insufficient balance. You have ${balance} cUSD`;
      
      return `✅ Bet placed!\n\n$${args.amount} on ${args.side.toUpperCase()}\nMarket: "${market.question}"`;
    }

    case 'get_markets': {
      const markets = await marketService.getMarkets();
      if (!markets.length) return 'No active markets. Create one!';
      
      return '📊 Active Markets:\n\n' + markets.map((m, i) => 
        `${i + 1}. "${m.question}"\n   ID: ${m.id}`
      ).join('\n\n');
    }

    case 'get_portfolio': {
      const positions = await marketService.getPortfolio(userId);
      if (!positions.length) return 'No positions yet. Place a bet!';
      
      return '💼 Your Portfolio:\n\n' + positions.map(p => 
        `"${p.market.question}"\n   YES: ${p.yesShares} | NO: ${p.noShares}`
      ).join('\n\n');
    }

    case 'get_balance': {
      const balance = await getBalance(address);
      return `💰 *Balance:* ${balance} cUSD\n📍 *Wallet:* \`${address}\``;
    }

    case 'get_deposit_info': {
      return `💳 *How to Deposit cUSD*

Your wallet address:
\`${address}\`

*Steps:*
1. Get testnet CELO from faucet:
   https://faucet.celo.org/celo-sepolia

2. Swap CELO for cUSD on Uniswap or get cUSD directly

3. Send cUSD to your wallet address above

*Network:* Celo Sepolia Testnet
*Token:* cUSD (Celo Dollar)

Once funded, you can place bets on prediction markets!`;
    }

    default:
      return 'Unknown action';
  }
}

export async function handleMessage(phoneNumber: string, text: string): Promise<string> {
  // Get or initialize context
  let context = userContext.get(phoneNumber) || [];
  context.push({ role: 'user', content: text });
  if (context.length > 10) context = context.slice(-10);
  userContext.set(phoneNumber, context);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...context,
      ],
      tools,
      tool_choice: 'auto',
    });

    const message = response.choices[0].message;

    // Handle tool calls
    if (message.tool_calls?.length) {
      const results: string[] = [];
      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        const result = await executeFunction(call.function.name, args, phoneNumber);
        results.push(result);
      }
      const reply = results.join('\n\n');
      context.push({ role: 'assistant', content: reply });
      userContext.set(phoneNumber, context);
      return reply;
    }

    // Regular text response
    const reply = message.content || "I didn't understand that. Try asking about markets or your balance!";
    context.push({ role: 'assistant', content: reply });
    userContext.set(phoneNumber, context);
    return reply;

  } catch (err) {
    console.error('OpenAI error:', err);
    return "Sorry, I'm having trouble right now. Please try again.";
  }
}
