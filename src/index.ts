import express from 'express';
import { config } from './config';
import { prisma } from './db';
import { parseWebhook, sendMessage, markAsRead } from './whatsapp';
import { handleMessage } from './agent';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

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
  
  const message = parseWebhook(req.body);
  if (!message) return;
  
  await markAsRead(message.messageId);
  
  try {
    const response = await handleMessage(message.from, message.text);
    await sendMessage(message.from, response);
  } catch (err) {
    console.error('Error handling message:', err);
    await sendMessage(message.from, "Sorry, something went wrong. Please try again.");
  }
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
