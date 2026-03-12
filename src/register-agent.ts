import { registerOrbaAgent, getRegistrationUrl, createSelfAgent, isAgentRegistered } from './integrations';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config';

async function main() {
  console.log('🤖 Orba Agent Registration\n');

  if (!config.celo.operatorKey || config.celo.operatorKey.length !== 66) {
    console.error('❌ Set OPERATOR_PRIVATE_KEY in .env (66 chars with 0x prefix)');
    process.exit(1);
  }

  const account = privateKeyToAccount(config.celo.operatorKey as `0x${string}`);
  console.log('Agent wallet:', account.address);

  // Step 1: ERC-8004 Registration
  console.log('\n📝 Step 1: ERC-8004 Registration');
  if (!config.pinata.jwt) {
    console.log('⚠️  Set PINATA_JWT to upload metadata to IPFS');
    console.log('   Get free API key at: https://pinata.cloud');
  } else {
    try {
      console.log('Uploading metadata to IPFS...');
      const { agentId, txHash, ipfsUri } = await registerOrbaAgent(account.address);
      console.log('✅ Agent registered!');
      console.log('   Agent ID:', agentId.toString());
      console.log('   IPFS URI:', ipfsUri);
      console.log('   TX Hash:', txHash);
      console.log('   View on agentscan: https://agentscan.info/agent/' + agentId);
    } catch (err: any) {
      console.log('❌ Registration failed:', err.message);
    }
  }

  // Step 2: Self AI Registration
  console.log('\n🔐 Step 2: Self AI Registration');
  const isRegistered = await isAgentRegistered(account.address);
  if (isRegistered) {
    console.log('✅ Agent already registered with Self AI');
  } else {
    console.log('⚠️  Agent not yet registered with Self AI');
    console.log('   Complete registration at:');
    console.log('   ' + getRegistrationUrl(account.address, account.address));
  }

  // Summary
  console.log('\n📋 Summary');
  console.log('─'.repeat(50));
  console.log('Agent Address:', account.address);
  console.log('Network: Celo Sepolia (chainId: 44787)');
  console.log('\nFor hackathon submission, include:');
  console.log('1. agentscan agentId (from ERC-8004 registration)');
  console.log('2. Self AI verification link');
  console.log('3. GitHub repo: https://github.com/tobi-techy/orba');
}

main().catch(console.error);
