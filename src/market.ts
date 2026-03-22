import { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatUnits, defineChain } from 'viem';
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
  'function createMarket(string question, uint256 resolutionTime) returns (uint256)',
  'function buy(uint256 marketId, bool isYes, uint256 amount) payable returns (uint256)',
  'function resolve(uint256 marketId, uint8 outcome)',
  'function claim(uint256 marketId) returns (uint256)',
  'function getPrice(uint256 marketId) view returns (uint256 yesPrice, uint256 noPrice)',
  'function markets(uint256) view returns (string question, uint256 resolutionTime, int256 qYes, int256 qNo, bool resolved, uint8 outcome)',
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
    return createWalletClient({ account, chain: celoSepolia, transport: http(config.celo.rpcUrl) });
  }

  async getPrice(onChainId: number): Promise<{ yes: number; no: number }> {
    try {
      const [yesPrice, noPrice] = await this.publicClient.readContract({
        address: this.contractAddress, abi, functionName: 'getPrice', args: [BigInt(onChainId)],
      });
      return { yes: Number(formatUnits(yesPrice, 18)), no: Number(formatUnits(noPrice, 18)) };
    } catch {
      return { yes: 0.5, no: 0.5 };
    }
  }

  async buy(
    marketId: string,
    userId: string,
    isYes: boolean,
    celoAmount: number, // in CELO (e.g. 1.0)
    account: ReturnType<typeof privateKeyToAccount>
  ): Promise<`0x${string}`> {
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market?.onChainId) throw new Error('Market not on chain');

    const walletClient = this.getWalletClient(account);
    const value = parseEther(celoAmount.toString());

    // Call buy() sending native CELO as msg.value
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi,
      functionName: 'buy',
      args: [BigInt(market.onChainId), isYes, value],
      value,
    });

    await prisma.position.upsert({
      where: { userId_marketId: { userId, marketId } },
      create: { userId, marketId, yesShares: isYes ? value : 0n, noShares: isYes ? 0n : value },
      update: isYes ? { yesShares: { increment: value } } : { noShares: { increment: value } },
    });

    await prisma.trade.create({
      data: { userId, marketId, outcome: isYes ? 1 : 0, shares: value, cost: value, txHash: hash },
    });

    return hash;
  }

  async getMarkets(limit = 10) {
    return prisma.market.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' }, take: limit });
  }

  async getPortfolio(userId: string) {
    return prisma.position.findMany({ where: { userId }, include: { market: true } });
  }
}
