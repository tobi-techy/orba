# Orba — AI Prediction Markets on Celo

> Conversational AI agent that turns Telegram chats into on-chain prediction markets with real CELO settlement on Celo Sepolia.

## Try It Now

**[@orba_predictions_bot](https://t.me/orba_predictions_bot)** on Telegram

## What It Does

- Browse real prediction markets by category (Sports, Crypto, Politics, Pop Culture)
- Place on-chain bets with native CELO — real blockchain transactions
- Auto-creates local markets from any topic or Polymarket result
- Group mode: detects hot takes and suggests markets automatically
- AI insights, debate mode, daily challenges
- Leveraged bets (2x/3x/5x) with liquidation tracking
- AI trading agent that bets autonomously every 5 minutes

## Quick Start

```bash
bun install
cp .env.example .env   # fill in your credentials
bun run db:push
bun run dev
```

## Commands

| Command | Description |
|---|---|
| `/start` | Onboard, get wallet, browse markets |
| `/markets` | Category browser with inline buttons |
| `bun run deploy` | Deploy contract to Celo Sepolia |
| `bun run register` | Register ERC-8004 agent identity |

## Architecture

- **Backend**: Express + TypeScript + Prisma + PostgreSQL
- **Blockchain**: Celo Sepolia — native CELO, smart contract `0x62fB5F476B4916e81B323b2381E7903a86049429`
- **AI**: Groq (llama-3.3-70b) with OpenAI fallback, function calling
- **Messaging**: Telegram Bot API
- **Markets**: Polymarket Gamma API (browse) + on-chain LMSR contract (bet)
- **Oracles**: CoinGecko (crypto prices), API-Football (sports)

## Hackathon Integrations

- **ERC-8004**: Agent ID `221` — [view on Agentscan](https://agentscan.info/agents/0xA8efEa979256D76adC307F7377455509C2e5BF14)
- **Celo Sepolia**: All bets settled on-chain with real tx hashes
- **AI Agent**: Autonomous trading agent registered on-chain

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `MASTER_SEED` | HD wallet mnemonic (12 words) |
| `OPERATOR_PRIVATE_KEY` | Deployer wallet private key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `GROQ_API_KEY` | Groq API key (primary LLM) |
| `OPENAI_API_KEY` | OpenAI API key (fallback) |
| `COINGECKO_API_KEY` | CoinGecko demo key |
| `PREDICTION_MARKET_ADDRESS` | Deployed contract address |

## Get Testnet CELO

1. Send `/start` to [@orba_predictions_bot](https://t.me/orba_predictions_bot) — get your wallet address
2. Go to [faucet.celo.org/celo-sepolia](https://faucet.celo.org/celo-sepolia)
3. Paste your wallet address → Claim CELO
4. Start betting!

## Deployment

Deployed on Render: [https://orba.onrender.com](https://orba.onrender.com)

```bash
# Health check
curl https://orba.onrender.com/health
```

## License

MIT
