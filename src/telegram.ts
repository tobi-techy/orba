import { config } from './config';

interface TelegramMessage {
  from: string;
  text: string;
  chatId: number;
}

export function parseTelegramWebhook(body: any): TelegramMessage | null {
  try {
    const message = body.message;
    if (!message?.text) return null;
    
    return {
      from: message.from.id.toString(),
      text: message.text,
      chatId: message.chat.id,
    };
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
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
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function setTelegramWebhook(url: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
