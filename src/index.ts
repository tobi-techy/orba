import express from 'express';
import { config } from './config';
import { startResolver } from './resolver';
import { startAIAgent } from './aiAgent';

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

    // Handle /start and /help commands
    if (message.text === '/start' || message.text === '/help') {
      // On /start, also show wallet info as onboarding
      if (message.text === '/start') {
        await telegram.sendTelegramMessage(
          message.chatId,
          telegram.WELCOME_MESSAGE,
          telegram.WELCOME_BUTTONS
        );
        // Send wallet onboarding as follow-up
        const { handleMessage } = await import('./agent');
        const stopT = telegram.sendTypingAction(message.chatId);
        const walletInfo = await handleMessage(message.from, 'What is my balance and wallet address?');
        stopT();
        await telegram.sendTelegramMessage(message.chatId, walletInfo);
      } else {
        await telegram.sendTelegramMessage(message.chatId, telegram.HELP_MESSAGE);
      }
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
          `*Hot take detected*\n\n_${message.senderName}:_ "${message.text}"\n\nSuggested market: "${hotTake.question}"\n\nWant to bet on this?`,
          [
            ['Create Market', 'Skip'],
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

    // Handle YES/NO bet button taps from search results
    if (message.text.startsWith('bet:yes:') || message.text.startsWith('bet:no:')) {
      const [, side, ...rest] = message.text.split(':');
      const question = decodeURIComponent(rest.join(':'));
      pendingBetPrompts.set(message.from, { question, side: side as 'yes' | 'no' });
      await telegram.sendTelegramMessageWithKeyboard(
        message.chatId,
        `You picked *${side.toUpperCase()}* on:\n_${question}_\n\nHow much cUSD?`,
        [
          [{ text: '$1', callback_data: `amount:1:1` }, { text: '$5', callback_data: `amount:5:1` }, { text: '$10', callback_data: `amount:10:1` }],
          [{ text: '$5 (2x)', callback_data: `amount:5:2` }, { text: '$5 (3x)', callback_data: `amount:5:3` }, { text: '$10 (2x)', callback_data: `amount:10:2` }],
        ]
      );
      return;
    }

    // Handle amount selection after YES/NO tap
    if (message.text.startsWith('amount:') && pendingBetPrompts.has(message.from)) {
      const { question, side } = pendingBetPrompts.get(message.from)!;
      pendingBetPrompts.delete(message.from);
      const [, amount, leverage] = message.text.split(':');
      const stopTyping = telegram.sendTypingAction(message.chatId);
      const response = await handleMessage(
        message.from,
        `bet $${amount} ${side} on ${question}${leverage !== '1' ? ` with ${leverage}x leverage` : ''}`,
        message.chatId
      );
      stopTyping();
      await telegram.sendTelegramMessage(message.chatId, response);
      return;
    }

    // Handle "Create Market" button from group hot take
    if (message.text === 'Create Market' && pendingGroupMarkets.has(message.chatId)) {
      const pending = pendingGroupMarkets.get(message.chatId)!;
      pendingGroupMarkets.delete(message.chatId);

      const stopTyping1 = telegram.sendTypingAction(message.chatId);
      const response = await handleMessage(
        message.from,
        `Create a market: ${pending.question}`
      );
      stopTyping1();
      await telegram.sendTelegramMessage(message.chatId, response, [
        ['Bet YES', 'Bet NO'],
        ['Balance', 'Markets'],
      ]);
      return;
    }

    if (message.text === 'Skip') {
      pendingGroupMarkets.delete(message.chatId);
      return;
    }

    // Handle bet buttons
    if (message.text === 'Bet YES' || message.text === 'Bet NO') {
      const side = message.text.includes('YES') ? 'yes' : 'no';

      // If in a group, DM the user to set up wallet first
      if (message.isGroup) {
        await telegram.sendTelegramMessage(
          message.chatId,
          `@${message.senderName}, DM me to place your bet and set up your wallet first!`
        );
        // Send DM to user
        await telegram.sendTelegramMessage(
          parseInt(message.from),
          `Hi! To bet on this market, you need a wallet first.\n\nSend /start to set up your wallet, then come back and bet.`,
          [['Balance', 'How to Deposit']]
        );
        return;
      }

      const stopTyping2 = telegram.sendTypingAction(message.chatId);
      const response = await handleMessage(message.from, `Place $1 bet on ${side}`);
      stopTyping2();
      await telegram.sendTelegramMessage(message.chatId, response);
      return;
    }

    // Handle button presses (private chat)
    const buttonMap: Record<string, string> = {
      'Balance': 'What is my balance?',
      'Markets': 'Show me all markets',
      'Create Market': 'I want to create a new prediction market',
      'Portfolio': 'Show my portfolio',
      'How to Deposit': 'How do I deposit funds?',
    };
    let text = buttonMap[message.text] || message.text;

    // Resolve market number aliases: "bet $5 on #2 yes" → inject real market ID
    const aliasMatch = text.match(/#(\d+)/);
    if (aliasMatch) {
      const idx = parseInt(aliasMatch[1]) - 1;
      const markets = await (await import('./db')).prisma.market.findMany({
        where: { resolved: false },
        orderBy: { resolutionTime: 'asc' },
        take: 10,
      });
      if (markets[idx]) {
        text = text.replace(`#${aliasMatch[1]}`, `market ID ${markets[idx].id}`);
      }
    }

    const stopTyping = telegram.sendTypingAction(message.chatId);
    const response = await handleMessage(message.from, text, message.chatId);
    stopTyping();
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

// Store pending bet confirmations (waiting for amount after YES/NO button tap)
const pendingBetPrompts = new Map<string, { question: string; side: 'yes' | 'no' }>();

app.listen(config.port, async () => {
  console.log(`Server running on port ${config.port}`);
  startResolver();
  startAIAgent();

  // Auto-register Telegram webhook
  if (config.telegram.botToken) {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (renderUrl) {
      const webhookUrl = `${renderUrl}/telegram`;
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true }),
        }
      );
      const data = await res.json() as any;
      console.log('Telegram webhook:', data.ok ? `registered → ${webhookUrl}` : data.description);
    } else {
      // Fallback: register with known Render URL
      const knownUrl = 'https://orba.onrender.com/telegram';
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: knownUrl, drop_pending_updates: true }),
        }
      );
      const data = await res.json() as any;
      console.log('Telegram webhook:', data.ok ? `registered → ${knownUrl}` : data.description);
    }
  }
});
