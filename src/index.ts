import express from 'express';
import { config } from './config';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple healthcheck
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Lazy load heavy modules
let handleMessage: any;
let parseWebhook: any;
let sendMessage: any;
let parseTelegramWebhook: any;
let sendTelegramMessage: any;

async function loadModules() {
  if (!handleMessage) {
    const agent = await import('./agent');
    handleMessage = agent.handleMessage;
    const whatsapp = await import('./whatsapp');
    parseWebhook = whatsapp.parseWebhook;
    sendMessage = whatsapp.sendMessage;
    const telegram = await import('./telegram');
    parseTelegramWebhook = telegram.parseTelegramWebhook;
    sendTelegramMessage = telegram.sendTelegramMessage;
  }
}

// WhatsApp webhook verification (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp webhook (Meta + Twilio)
app.post('/webhook', async (req, res) => {
  const isTwilio = req.body.From?.startsWith('whatsapp:');
  if (isTwilio) {
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  } else {
    res.sendStatus(200);
  }

  try {
    await loadModules();
    const message = parseWebhook(req.body);
    if (!message) return;
    const response = await handleMessage(message.from, message.text);
    await sendMessage(message.from, response);
  } catch (err) {
    console.error('WhatsApp error:', err);
  }
});

// Telegram webhook
app.post('/telegram', async (req, res) => {
  res.sendStatus(200);

  try {
    await loadModules();
    const telegram = await import('./telegram');
    const message = telegram.parseTelegramWebhook(req.body);
    if (!message) return;

    // Answer callback query if present
    if (req.body.callback_query) {
      await telegram.answerCallback(req.body.callback_query.id);
    }

    // Handle /start command
    if (message.text === '/start') {
      await telegram.sendTelegramMessage(
        message.chatId,
        telegram.WELCOME_MESSAGE,
        telegram.WELCOME_BUTTONS
      );
      return;
    }

    // Handle button presses
    const buttonMap: Record<string, string> = {
      '💰 My Balance': 'What is my balance?',
      '📊 View Markets': 'Show me all markets',
      '➕ Create Market': 'I want to create a new prediction market',
      '📈 My Portfolio': 'Show my portfolio',
      'ℹ️ How to Deposit': 'How do I deposit funds?',
    };
    const text = buttonMap[message.text] || message.text;

    const response = await handleMessage(message.from, text);
    await telegram.sendTelegramMessage(message.chatId, response);
  } catch (err) {
    console.error('Telegram error:', err);
  }
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
