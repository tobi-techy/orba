import { mnemonicToAccount } from 'viem/accounts';
import { createPublicClient, http, formatUnits } from 'viem';
import { celoAlfajores } from 'viem/chains';
import { config } from './config';
import { prisma } from './db';

const publicClient = createPublicClient({
  chain: celoAlfajores,
  transport: http(config.celo.rpcUrl),
});

// Derive deterministic wallet from phone number
function deriveWallet(index: number) {
  return mnemonicToAccount(config.celo.masterSeed, { addressIndex: index });
}

export async function getOrCreateWallet(phoneNumber: string) {
  let user = await prisma.user.findUnique({ where: { phoneNumber } });
  if (!user) {
    user = await prisma.user.create({ data: { phoneNumber } });
  }
  const account = deriveWallet(user.walletIndex);
  return { address: account.address, account, userId: user.id };
}

export async function getBalance(address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: config.celo.cUsdAddress,
      abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'balanceOf',
      args: [address],
    });
    return formatUnits(balance, 18);
  } catch {
    return '0';
  }
}

export { publicClient };
