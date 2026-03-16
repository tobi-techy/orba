import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config';
import { prisma } from './db';

const celoSepolia = defineChain({
  id: config.celo.chainId,
  name: 'Celo Sepolia',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: { default: { http: [config.celo.rpcUrl] } },
});

const abi = parseAbi([
  'function createMarket(string question, uint256 resolutionTime, bytes32 oracleData) returns (uint256)',
  'function buy(uint256 marketId, bool isYes, uint256 amount) returns (uint256)',
  'function resolve(uint256 marketId, uint8 outcome)',
  'function claim(uint256 marketId) returns (uint256)',
  'function getPrice(uint256 marketId) view returns (uint256 yesPrice, uint256 noPrice)',
  'function markets(uint256) view returns (string question, uint256 resolutionTime, int256 qYes, int256 qNo, bool resolved, uint8 outcome, bytes32 oracleData)',
]);

const cUsdAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

export class MarketService {
  private publicClient;
  private contractAddress: `0x${string}`;

  constructor(contractAddress: `0x${string}`) {
    this.contractAddress = contractAddress;
    this.publicClient = createPublicClient({
      chain: celoSepolia,
      transport: http(config.celo.rpcUrl),
    });
  }

  private getWalletClient(account: ReturnType<typeof privateKeyToAccount>) {
    return createWalletClient({
      account,
      chain: celoSepolia,
      transport: http(config.celo.rpcUrl),
    });
  }

  async createMarket(question: string, resolutionTime: Date, oracleType: string, oracleData: object, creatorId: string) {
    const oracleHash = `0x${Buffer.from(JSON.stringify(oracleData).slice(0, 32).padEnd(32, '\0')).toString('hex')}` as `0x${string}`;
    
    // Store in DB first
    const market = await prisma.market.create({
      data: {
        question,
        resolutionTime,
        oracleType,
        oracleData,
        creatorId,
      },
    });

    return market;
  }

  async getPrice(onChainId: number): Promise<{ yes: number; no: number }> {
    try {
      const [yesPrice, noPrice] = await this.publicClient.readContract({
        address: this.contractAddress,
        abi,
        functionName: 'getPrice',
        args: [BigInt(onChainId)],
      });
      return {
        yes: Number(formatUnits(yesPrice, 18)),
        no: Number(formatUnits(noPrice, 18)),
      };
    } catch {
      return { yes: 0.5, no: 0.5 };
    }
  }

  async buy(marketId: string, userId: string, isYes: boolean, amount: bigint, account: ReturnType<typeof privateKeyToAccount>) {
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market?.onChainId) throw new Error('Market not on chain');

    const walletClient = this.getWalletClient(account);

    // Approve cUSD
    await walletClient.writeContract({
      address: config.celo.cUsdAddress,
      abi: cUsdAbi,
      functionName: 'approve',
      args: [this.contractAddress, amount],
    });

    // Buy shares
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi,
      functionName: 'buy',
      args: [BigInt(market.onChainId), isYes, amount],
    });

    // Update position in DB
    await prisma.position.upsert({
      where: { userId_marketId: { userId, marketId } },
      create: { userId, marketId, yesShares: isYes ? amount : 0n, noShares: isYes ? 0n : amount },
      update: isYes 
        ? { yesShares: { increment: amount } }
        : { noShares: { increment: amount } },
    });

    await prisma.trade.create({
      data: { userId, marketId, outcome: isYes ? 1 : 0, shares: amount, cost: amount, txHash: hash },
    });

    return hash;
  }

  async getMarkets(limit = 10) {
    return prisma.market.findMany({
      where: { resolved: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getPortfolio(userId: string) {
    return prisma.position.findMany({
      where: { userId },
      include: { market: true },
    });
  }
}
