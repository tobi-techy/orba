import { config } from './config';

interface TelegramMessage {
  from: string;
  text: string;
  chatId: number;
  isCommand?: boolean;
  isGroup?: boolean;
  senderName?: string;
}

export function parseTelegramWebhook(body: any): TelegramMessage | null {
  try {
    const message = body.message || body.callback_query?.message;
    const callbackData = body.callback_query?.data;
    const from = body.callback_query?.from || body.message?.from;
    
    if (!from) return null;
    
    const chatType = (body.message || body.callback_query?.message)?.chat?.type;
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Someone';

    if (callbackData) {
      return {
        from: from.id.toString(),
        text: callbackData,
        chatId: message.chat.id,
        isCommand: true,
        isGroup,
        senderName,
      };
    }
    
    if (!message?.text) return null;
    
    return {
      from: from.id.toString(),
      text: message.text,
      chatId: message.chat.id,
      isCommand: message.text.startsWith('/'),
      isGroup,
      senderName,
    };
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(chatId: number, text: string, buttons?: string[][]): Promise<boolean> {
  try {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    };
    
    if (buttons?.length) {
      body.reply_markup = {
        inline_keyboard: buttons.map(row => 
          row.map(btn => ({ text: btn, callback_data: btn }))
        ),
      };
    }
    
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramMessageWithKeyboard(
  chatId: number,
  text: string,
  keyboard: { text: string; callback_data: string }[][]
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard },
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function answerCallback(callbackId: string): Promise<void> {
  try {
    await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/answerCallbackQuery`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackId }),
      }
    );
  } catch {}
}

async function sendChatAction(chatId: number): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  } catch {}
}

// Keeps "typing..." visible until the returned stop() is called
export function sendTypingAction(chatId: number): () => void {
  sendChatAction(chatId);
  const interval = setInterval(() => sendChatAction(chatId), 4000);
  return () => clearInterval(interval);
}

export const WELCOME_MESSAGE = `*Welcome to Orba* 🎯

Your AI prediction market assistant on Celo.

*What you can do:*
• Create markets on crypto prices or sports
• Bet YES/NO with cUSD stablecoins
• Track your portfolio and winnings

Just chat naturally or use the buttons below.`;

export const HELP_MESSAGE = `*Orba Commands*

*Markets*
• "Show me markets" — list open markets
• "Find markets about BTC" — search by topic
• "Trending markets" — top markets by volume

*Betting*
• "Bet $5 on YES for market #1" — place a bet
• "Bet $10 on NO with 2x leverage" — leveraged bet
• Markets are listed as #1, #2, etc.

*Portfolio*
• "My balance" — check cUSD balance
• "My portfolio" — see your positions
• "How to deposit" — funding instructions

*AI Features*
• "Analyse BTC" — market insights
• "I think ETH will dump" — debate mode
• "Daily challenge" — gamified predictions

*Fast Markets*
• "Create a 5-min market: will BTC move 1%?"
• "Create a 1-hour market on ETH price"`;

export const WELCOME_BUTTONS = [
  ['Balance', 'Markets'],
  ['Create Market', 'Portfolio'],
  ['How to Deposit'],
];
