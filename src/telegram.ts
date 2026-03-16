import { config } from './config';

interface TelegramMessage {
  from: string;
  text: string;
  chatId: number;
  isCommand?: boolean;
}

export function parseTelegramWebhook(body: any): TelegramMessage | null {
  try {
    const message = body.message || body.callback_query?.message;
    const callbackData = body.callback_query?.data;
    const from = body.callback_query?.from || body.message?.from;
    
    if (!from) return null;
    
    // Handle callback button presses
    if (callbackData) {
      return {
        from: from.id.toString(),
        text: callbackData,
        chatId: message.chat.id,
        isCommand: true,
      };
    }
    
    if (!message?.text) return null;
    
    return {
      from: from.id.toString(),
      text: message.text,
      chatId: message.chat.id,
      isCommand: message.text.startsWith('/'),
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

export const WELCOME_MESSAGE = `🎯 *Welcome to Orba!*

I'm your AI-powered prediction market assistant on Celo.

*What I can do:*
• Create prediction markets (crypto, sports)
• Place bets with cUSD stablecoins
• Track your portfolio & winnings
• Auto-resolve markets via oracles

*Powered by:*
🔗 Celo Sepolia Testnet
🤖 ERC-8004 Agent Identity
✅ Self AI Verified

Tap a button or just chat naturally!`;

export const WELCOME_BUTTONS = [
  ['💰 My Balance', '📊 View Markets'],
  ['➕ Create Market', '📈 My Portfolio'],
  ['ℹ️ How to Deposit'],
];
