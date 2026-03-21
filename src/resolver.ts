import { prisma } from './db';
import { getCryptoPrice, resolveCryptoMarket } from './oracles/crypto';

// Liquidation buffer: liquidate if price moves against leveraged position by (1/leverage)
function getLiquidationPrice(entryPrice: number, leverage: number, isYes: boolean): number {
  const buffer = entryPrice / leverage;
  return isYes ? entryPrice - buffer : entryPrice + buffer;
}

async function checkLiquidations(coin: string, currentPrice: number) {
  const markets = await prisma.market.findMany({
    where: { resolved: false, oracleType: 'crypto' },
    include: { positions: { where: { liquidated: false, leverage: { gt: 1 } } } },
  });

  for (const market of markets) {
    const oracleData = market.oracleData as any;
    if (oracleData?.coin?.toLowerCase() !== coin.toLowerCase()) continue;

    for (const pos of market.positions) {
      if (!pos.liquidationPrice) continue;
      const isYes = pos.yesShares > 0n;
      const liquidated = isYes
        ? currentPrice <= pos.liquidationPrice
        : currentPrice >= pos.liquidationPrice;

      if (liquidated) {
        await prisma.position.update({
          where: { id: pos.id },
          data: { liquidated: true, yesShares: 0n, noShares: 0n },
        });
        console.log(`Liquidated position ${pos.id} at price ${currentPrice}`);
      }
    }
  }
}

async function resolveExpiredMarkets() {
  const expired = await prisma.market.findMany({
    where: { resolved: false, resolutionTime: { lte: new Date() } },
  });

  for (const market of expired) {
    try {
      if (market.oracleType === 'crypto') {
        const data = market.oracleData as any;
        const priceData = await getCryptoPrice(data.coin);
        if (!priceData) continue;

        const outcome = resolveCryptoMarket(priceData.price, data) ? 1 : 0;
        await prisma.market.update({
          where: { id: market.id },
          data: { resolved: true, outcome },
        });
        console.log(`Resolved market "${market.question}" → ${outcome === 1 ? 'YES' : 'NO'} (price: $${priceData.price})`);

        // Update daily challenges for correct predictors
        const winners = await prisma.position.findMany({
          where: {
            marketId: market.id,
            ...(outcome === 1 ? { yesShares: { gt: 0n } } : { noShares: { gt: 0n } }),
            liquidated: false,
          },
        });
        for (const pos of winners) {
          const today = new Date().toISOString().slice(0, 10);
          await prisma.dailyChallenge.upsert({
            where: { userId_date: { userId: pos.userId, date: today } },
            create: { userId: pos.userId, date: today, completed: 1 },
            update: { completed: { increment: 1 } },
          }).then(async (challenge) => {
            if (!challenge.done && challenge.completed >= challenge.target) {
              await prisma.dailyChallenge.update({
                where: { id: challenge.id },
                data: { done: true },
              });
            }
          });
        }
      }
    } catch (err) {
      console.error(`Failed to resolve market ${market.id}:`, err);
    }
  }
}

// Run every minute
export function startResolver() {
  console.log('Market resolver started');
  resolveExpiredMarkets();
  setInterval(resolveExpiredMarkets, 60_000);

  // Check liquidations every 30s for active leveraged crypto markets
  setInterval(async () => {
    const coins = ['bitcoin', 'ethereum', 'solana', 'celo'];
    for (const coin of coins) {
      const priceData = await getCryptoPrice(coin);
      if (priceData) await checkLiquidations(coin, priceData.price);
    }
  }, 30_000);
}
