import express from 'express';
import { config } from './config';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio

// Simple healthcheck - no DB dependency
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Lazy load heavy modules only when needed
let prisma: any;
let handleMessage: any;
let parseWebhook: any;
let sendMessage: any;
let markAsRead: any;

async function loadModules() {
  if (!prisma) {
    const db = await import('./db');
    prisma = db.prisma;
    const agent = await import('./agent');
    handleMessage = agent.handleMessage;
    const whatsapp = await import('./whatsapp');
    parseWebhook = whatsapp.parseWebhook;
    sendMessage = whatsapp.sendMessage;
    markAsRead = whatsapp.markAsRead;
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

// WhatsApp message handler (Meta + Twilio)
app.post('/webhook', async (req, res) => {
  // Twilio expects 200 with TwiML or empty response
  const isTwilio = req.body.From?.startsWith('whatsapp:');
  
  if (isTwilio) {
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>'); // Empty TwiML
  } else {
    res.sendStatus(200);
  }
  
  try {
    await loadModules();
    const message = parseWebhook(req.body);
    if (!message) return;
    
    await markAsRead(message.messageId);
    const response = await handleMessage(message.from, message.text);
    await sendMessage(message.from, response);
  } catch (err) {
    console.error('Error handling message:', err);
    if (sendMessage) {
      const from = req.body.From?.replace('whatsapp:', '') || req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) await sendMessage(from, "Sorry, something went wrong. Please try again.");
    }
  }
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
