import { mnemonicToAccount } from 'viem/accounts';
import { createPublicClient, http, formatUnits, defineChain } from 'viem';
import { config } from './config';
import { prisma } from './db';

const celoSepolia = defineChain({
  id: config.celo.chainId,
  name: 'Celo Sepolia',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: { default: { http: [config.celo.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain: celoSepolia,
  transport: http(config.celo.rpcUrl),
});

// Derive deterministic wallet from user index
function deriveWallet(index: number) {
  return mnemonicToAccount(config.celo.masterSeed, { addressIndex: index });
}

export async function getOrCreateWallet(phoneNumber: string) {
  // Sanitize input
  const sanitized = phoneNumber.replace(/[^a-zA-Z0-9+_-]/g, '').slice(0, 64);
  if (!sanitized) throw new Error('Invalid user identifier');

  let user = await prisma.user.findUnique({ where: { phoneNumber: sanitized } });
  if (!user) {
    user = await prisma.user.create({ data: { phoneNumber: sanitized } });
  }
  const account = deriveWallet(user.walletIndex);
  return { address: account.address, account, userId: user.id };
}

export async function getBalance(address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.getBalance({ address });
    return parseFloat(formatUnits(balance, 18)).toFixed(4);
  } catch {
    return '0';
  }
}

export { publicClient };
