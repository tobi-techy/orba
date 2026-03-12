# Orba - WhatsApp Prediction Markets on Celo

Conversational AI agent that turns WhatsApp chats into prediction markets with on-chain settlement.

## Quick Start

```bash
# Install dependencies
bun install

# Set up database
docker compose up -d
bun run db:push

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run locally
bun run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `MASTER_SEED` | HD wallet mnemonic (12 words) | Yes |
| `OPERATOR_PRIVATE_KEY` | Deployer wallet private key | Yes |
| `OPENAI_API_KEY` | GPT-4 API key | Yes |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | Yes* |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Yes* |
| `TWILIO_WHATSAPP_NUMBER` | Twilio sandbox number | Yes* |
| `PINATA_JWT` | Pinata API key for IPFS | For registration |

*Or use Meta WhatsApp Business API credentials instead

## Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/orba)

1. Click button above or run:
   ```bash
   railway login
   railway init
   railway add --database postgres
   railway up
   ```

2. Set environment variables in Railway dashboard

3. Get your public URL and set as Twilio webhook

## Commands

```bash
bun run dev          # Start development server
bun run deploy       # Deploy contract to Celo Sepolia
bun run register     # Register agent (ERC-8004 + Self AI)
```

## Architecture

- **Backend**: Express + TypeScript + Prisma
- **Blockchain**: Celo Sepolia, cUSD stablecoin
- **AI**: GPT-4 with function calling
- **Messaging**: Twilio WhatsApp Sandbox
- **Oracles**: CoinGecko (crypto), API-Football (sports)

## Hackathon Integrations

- **ERC-8004**: Agent identity on Celo
- **Self AI**: Human-backed verification
- **x402**: Payment protocol for agent transactions

## Try It

1. Text `join <sandbox-code>` to `+1 415 523 8886` on WhatsApp
2. Start chatting: "Create a market: Will BTC hit $100k by April?"
3. Place bets: "Put $10 on YES"
4. Check portfolio: "How am I doing?"

## License

MIT
