import { privateKeyToAccount, signMessage } from 'viem/accounts';
import { config } from '../config';

// Self AI agent verification
// Docs: https://app.ai.self.xyz/integration

export class SelfAgent {
  private account;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address() {
    return this.account.address;
  }

  // Sign a request for Self AI verification
  async signRequest(method: string, url: string, body?: string): Promise<{
    'x-self-agent-address': string;
    'x-self-agent-timestamp': string;
    'x-self-agent-signature': string;
  }> {
    const timestamp = Date.now().toString();
    const bodyHash = body ? await this.hash(body) : '';
    const message = `${timestamp}:${method}:${url}:${bodyHash}`;
    
    const signature = await this.account.signMessage({ message });

    return {
      'x-self-agent-address': this.account.address,
      'x-self-agent-timestamp': timestamp,
      'x-self-agent-signature': signature,
    };
  }

  private async hash(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Make authenticated fetch request
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const method = options.method || 'GET';
    const body = options.body?.toString();
    const headers = await this.signRequest(method, url, body);

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...headers,
      },
    });
  }
}

// Check if agent is registered with Self AI
export async function isAgentRegistered(address: string): Promise<boolean> {
  try {
    const res = await fetch(`https://app.ai.self.xyz/api/agents/${address}`);
    return res.ok;
  } catch {
    return false;
  }
}

// Get Self AI registration URL for manual registration
export function getRegistrationUrl(agentAddress: string, humanAddress: string): string {
  return `https://app.ai.self.xyz/agents/register?mode=linked&agent=${agentAddress}&human=${humanAddress}&network=celo-sepolia`;
}

// Create agent instance from config
export function createSelfAgent(): SelfAgent | null {
  if (!config.celo.operatorKey) return null;
  return new SelfAgent(config.celo.operatorKey as `0x${string}`);
}
