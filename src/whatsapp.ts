import { config } from './config';

interface WhatsAppMessage {
  from: string;
  text: string;
  messageId: string;
}

// Support both Meta and Twilio webhooks
export function parseWebhook(body: any): WhatsAppMessage | null {
  try {
    // Twilio format
    if (body.From && body.Body) {
      return {
        from: body.From.replace('whatsapp:', ''),
        text: body.Body,
        messageId: body.MessageSid || body.SmsMessageSid || '',
      };
    }

    // Meta format
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (message?.type === 'text') {
      return {
        from: message.from,
        text: message.text.body,
        messageId: message.id,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Send via Twilio
async function sendViaTwilio(to: string, text: string): Promise<boolean> {
  const { accountSid, authToken, phoneNumber } = config.twilio;
  if (!accountSid || !authToken || !phoneNumber) return false;

  try {
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const fromNumber = phoneNumber.startsWith('whatsapp:') ? phoneNumber : `whatsapp:${phoneNumber}`;

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: toNumber,
          From: fromNumber,
          Body: text,
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Send via Meta
async function sendViaMeta(to: string, text: string): Promise<boolean> {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) return false;

  try {
    const res = await fetch(
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
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendMessage(to: string, text: string): Promise<boolean> {
  // Try Twilio first, fall back to Meta
  if (config.twilio.accountSid) {
    return sendViaTwilio(to, text);
  }
  return sendViaMeta(to, text);
}

export async function markAsRead(messageId: string): Promise<void> {
  // Only works with Meta API
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) return;
  
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
