import { config } from './config';

interface WhatsAppMessage {
  from: string;
  text: string;
  messageId: string;
}

export function parseWebhook(body: any): WhatsAppMessage | null {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    
    if (!message || message.type !== 'text') return null;
    
    return {
      from: message.from,
      text: message.text.body,
      messageId: message.id,
    };
  } catch {
    return null;
  }
}

export async function sendMessage(to: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.whatsapp.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function markAsRead(messageId: string): Promise<void> {
  try {
    await fetch(
      `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.whatsapp.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      }
    );
  } catch {}
}
