import express from 'express';
import { config } from './config';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting per user (max 10 messages per minute)
const rateLimits = new Map<string, number[]>();
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimits.get(userId) || []).filter(t => now - t < 60000);
  if (timestamps.length >= 10) return true;
  timestamps.push(now);
  rateLimits.set(userId, timestamps);
  return false;
}
// Clean up rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) {
    const filtered = v.filter(t => now - t < 60000);
    if (!filtered.length) rateLimits.delete(k);
    else rateLimits.set(k, filtered);
  }
}, 300000);

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

    // Rate limit check
    if (isRateLimited(message.from)) return;

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

    // GROUP MODE: listen for hot takes
    if (message.isGroup && !message.isCommand && !message.text.startsWith('/')) {
      // Skip short messages
      if (message.text.length < 10) return;

      const { detectHotTake } = await import('./hotTakeDetector');
      const hotTake = await detectHotTake(message.text, message.senderName || 'Someone');
      if (hotTake) {
        const callbackData = `create_from_take:${hotTake.question}:${hotTake.oracleType}`;
        await telegram.sendTelegramMessage(
          message.chatId,
          `🔥 *Hot take detected!*\n\n_${message.senderName} thinks:_ "${message.text}"\n\n📊 *Suggested market:*\n"${hotTake.question}"\n\nWant to bet on this?`,
          [
            ['✅ Create Market', '❌ Skip'],
          ]
        );
        // Store pending market for this group
        pendingGroupMarkets.set(message.chatId, {
          question: hotTake.question,
          oracleType: hotTake.oracleType,
          suggestedBy: message.from,
          senderName: message.senderName || 'Someone',
        });
      }
      return;
    }

    // Handle "Create Market" button from group hot take
    if (message.text === '✅ Create Market' && pendingGroupMarkets.has(message.chatId)) {
      const pending = pendingGroupMarkets.get(message.chatId)!;
      pendingGroupMarkets.delete(message.chatId);

      const response = await handleMessage(
        message.from,
        `Create a market: ${pending.question}`
      );
      await telegram.sendTelegramMessage(message.chatId, response, [
        ['🟢 Bet YES', '🔴 Bet NO'],
        ['💰 My Balance', '📊 View Markets'],
      ]);
      return;
    }

    if (message.text === '❌ Skip') {
      pendingGroupMarkets.delete(message.chatId);
      return;
    }

    // Handle bet buttons
    if (message.text === '🟢 Bet YES' || message.text === '🔴 Bet NO') {
      const side = message.text.includes('YES') ? 'yes' : 'no';
      const response = await handleMessage(message.from, `Place $1 bet on ${side}`);
      await telegram.sendTelegramMessage(message.chatId, response);
      return;
    }

    // Handle button presses (private chat)
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

// Store pending group markets
const pendingGroupMarkets = new Map<number, {
  question: string;
  oracleType: string;
  suggestedBy: string;
  senderName: string;
}>();

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
