import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  database: { url: process.env.DATABASE_URL! },
  celo: {
    rpcUrl: process.env.CELO_RPC_URL || 'https://alfajores-forno.celo-testnet.org',
    masterSeed: process.env.MASTER_SEED!,
    operatorKey: process.env.OPERATOR_PRIVATE_KEY!,
    chainId: 44787, // Celo Sepolia
    cUsdAddress: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1' as const,
    contractAddress: process.env.PREDICTION_MARKET_ADDRESS || '',
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN!,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_WHATSAPP_NUMBER, // e.g., +14155238886
  },
  openai: { apiKey: process.env.OPENAI_API_KEY! },
  oracles: {
    coinGeckoKey: process.env.COINGECKO_API_KEY,
    apiFootballKey: process.env.API_FOOTBALL_KEY,
  },
  thirdweb: {
    clientId: process.env.THIRDWEB_CLIENT_ID,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
  },
  pinata: { jwt: process.env.PINATA_JWT },
};
