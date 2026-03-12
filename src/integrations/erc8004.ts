import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { celoAlfajores } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config';

// ERC-8004 Identity Registry on Celo Sepolia
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;

const registryAbi = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function agentURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
]);

export interface AgentMetadata {
  type: 'Agent';
  name: string;
  description: string;
  image?: string;
  endpoints: Array<{
    type: 'wallet' | 'a2a' | 'mcp';
    url?: string;
    address?: string;
    chainId?: number;
  }>;
  supportedTrust?: string[];
}

export async function uploadToIPFS(metadata: AgentMetadata): Promise<string> {
  if (!config.pinata.jwt) throw new Error('PINATA_JWT not configured');

  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.pinata.jwt}`,
    },
    body: JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: { name: `orba-agent-${Date.now()}` },
    }),
  });

  const data = await res.json();
  return `ipfs://${data.IpfsHash}`;
}

export async function registerAgent(agentURI: string): Promise<{ agentId: bigint; txHash: string }> {
  if (!config.celo.operatorKey) throw new Error('OPERATOR_PRIVATE_KEY not configured');

  const account = privateKeyToAccount(config.celo.operatorKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: celoAlfajores,
    transport: http(config.celo.rpcUrl),
  });

  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: registryAbi,
    functionName: 'register',
    args: [agentURI],
  });

  // Get agentId from transaction receipt
  const publicClient = createPublicClient({
    chain: celoAlfajores,
    transport: http(config.celo.rpcUrl),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  // Parse Transfer event to get tokenId (agentId)
  const agentId = BigInt(receipt.logs[0]?.topics[3] || '0');

  return { agentId, txHash: hash };
}

export async function getAgentURI(agentId: bigint): Promise<string> {
  const publicClient = createPublicClient({
    chain: celoAlfajores,
    transport: http(config.celo.rpcUrl),
  });

  return publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: registryAbi,
    functionName: 'agentURI',
    args: [agentId],
  });
}

// Helper to register Orba agent
export async function registerOrbaAgent(walletAddress: string): Promise<{ agentId: bigint; txHash: string; ipfsUri: string }> {
  const metadata: AgentMetadata = {
    type: 'Agent',
    name: 'Orba Prediction Markets',
    description: 'WhatsApp-based conversational prediction market agent on Celo. Create markets, place bets, and get paid through natural language.',
    endpoints: [
      { type: 'wallet', address: walletAddress, chainId: 44787 },
    ],
    supportedTrust: ['reputation', 'self-ai'],
  };

  const ipfsUri = await uploadToIPFS(metadata);
  const { agentId, txHash } = await registerAgent(ipfsUri);

  return { agentId, txHash, ipfsUri };
}
