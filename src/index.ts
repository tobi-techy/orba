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
    const message = parseTelegramWebhook(req.body);
    if (!message) return;
    const response = await handleMessage(message.from, message.text);
    await sendTelegramMessage(message.chatId, response);
  } catch (err) {
    console.error('Telegram error:', err);
  }
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
