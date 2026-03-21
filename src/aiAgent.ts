import { prisma } from './db';
import { getCryptoPrice } from './oracles/crypto';
import OpenAI from 'openai';
import { config } from './config';

const client = new OpenAI({
  apiKey: config.groq.apiKey || config.openai.apiKey,
  baseURL: config.groq.apiKey ? 'https://api.groq.com/openai/v1' : undefined,
});
const model = config.groq.apiKey ? 'llama-3.3-70b-versatile' : 'gpt-4o';

const AI_AGENT_USER_ID = 'ai-trading-agent';
const BET_SIZE = 1; // $1 per bet

async function ensureAgentUser() {
  await prisma.user.upsert({
    where: { phoneNumber: 'ai-agent' },
    create: { phoneNumber: 'ai-agent' },
    update: {},
  });
  const user = await prisma.user.findUnique({ where: { phoneNumber: 'ai-agent' } });
  return user!.id;
}

async function decideBet(question: string, oracleData: any): Promise<{ side: 'yes' | 'no'; confidence: number } | null> {
  let context = question;

  if (oracleData?.coin) {
    const price = await getCryptoPrice(oracleData.coin);
    if (price) context += ` (current price: $${price.price})`;
  }

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an AI trading agent. Given a prediction market question, decide YES or NO and your confidence (0.5-1.0). Return JSON only: {"side":"yes"|"no","confidence":0.0-1.0}. Only bet if confidence > 0.65.',
        },
        { role: 'user', content: context },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    if (parsed.confidence >= 0.65) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function runAgentBets() {
  const agentUserId = await ensureAgentUser();

  const markets = await prisma.market.findMany({
    where: {
      resolved: false,
      resolutionTime: { gt: new Date() },
    },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  for (const market of markets) {
    // Skip if agent already has a position
    const existing = await prisma.position.findUnique({
      where: { userId_marketId: { userId: agentUserId, marketId: market.id } },
    });
    if (existing) continue;

    const decision = await decideBet(market.question, market.oracleData);
    if (!decision) continue;

    const shares = BigInt(Math.round(BET_SIZE * 1e18));
    await prisma.position.create({
      data: {
        userId: agentUserId,
        marketId: market.id,
        yesShares: decision.side === 'yes' ? shares : 0n,
        noShares: decision.side === 'no' ? shares : 0n,
      },
    });

    await prisma.trade.create({
      data: {
        userId: agentUserId,
        marketId: market.id,
        outcome: decision.side === 'yes' ? 1 : 0,
        shares,
        cost: shares,
      },
    });

    console.log(`AI Agent bet ${decision.side.toUpperCase()} on "${market.question}" (confidence: ${decision.confidence})`);
  }
}

// Run every 5 minutes
export function startAIAgent() {
  console.log('AI Trading Agent started');
  runAgentBets();
  setInterval(runAgentBets, 5 * 60_000);
}
