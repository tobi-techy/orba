import OpenAI from 'openai';
import { config } from './config';

const client = new OpenAI({
  apiKey: config.groq.apiKey || config.openai.apiKey,
  baseURL: config.groq.apiKey ? 'https://api.groq.com/openai/v1' : undefined,
});
const model = config.groq.apiKey ? 'llama-3.3-70b-versatile' : 'gpt-4o';

interface HotTake {
  isPredictable: boolean;
  question: string;
  oracleType: 'crypto' | 'sports' | 'general';
  confidence: number;
}

export async function detectHotTake(message: string, senderName: string): Promise<HotTake | null> {
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You detect if a message contains a predictable claim that could become a betting market. 
Return JSON only. If the message is a strong opinion or prediction about crypto prices, sports outcomes, or verifiable future events, return:
{"isPredictable":true,"question":"<reworded as a yes/no question>","oracleType":"crypto|sports|general","confidence":0.0-1.0}

If not predictable, return: {"isPredictable":false,"question":"","oracleType":"general","confidence":0}

Examples of predictable statements:
- "BTC will hit 100k" → {"isPredictable":true,"question":"Will BTC hit $100k by end of month?","oracleType":"crypto","confidence":0.9}
- "Arsenal is winning the league" → {"isPredictable":true,"question":"Will Arsenal win the Premier League?","oracleType":"sports","confidence":0.85}
- "ETH is going to dump" → {"isPredictable":true,"question":"Will ETH drop more than 10% this week?","oracleType":"crypto","confidence":0.7}

NOT predictable: greetings, questions, general chat, vague opinions without specific outcomes.
Only return confidence > 0.7 for clear, specific predictions.`,
        },
        { role: 'user', content: `${senderName} said: "${message}"` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    if (parsed.isPredictable && parsed.confidence >= 0.7) return parsed;
    return null;
  } catch {
    return null;
  }
}
