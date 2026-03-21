import { Request, Response, NextFunction } from 'express';
import { createWalletClient, http, parseUnits } from 'viem';
import { celoAlfajores } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config';

// x402 Payment Protocol
// When a request requires payment, return 402 with payment details
// Client pays, retries with X-PAYMENT header, server verifies and processes

interface PaymentRequirement {
  price: string; // e.g., "$0.01"
  token: string;
  recipient: string;
  description: string;
}

// Middleware to require x402 payment
export function requirePayment(requirement: PaymentRequirement) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];

    if (!paymentHeader) {
      // Return 402 Payment Required
      return res.status(402).json({
        error: 'Payment Required',
        x402: {
          version: '1',
          price: requirement.price,
          token: requirement.token,
          recipient: requirement.recipient,
          network: 'celo-sepolia',
          chainId: 44787,
          description: requirement.description,
        },
      });
    }

    // For hackathon demo: accept any payment header as valid
    // Production would verify the signature and on-chain payment
    try {
      // Simplified verification - just check header exists
      if (typeof paymentHeader === 'string' && paymentHeader.length > 10) {
        (req as any).paymentVerified = true;
        return next();
      }
      throw new Error('Invalid payment');
    } catch {
      return res.status(402).json({
        error: 'Payment verification failed',
        x402: {
          version: '1',
          price: requirement.price,
          token: requirement.token,
          recipient: requirement.recipient,
          network: 'celo-sepolia',
          chainId: 44787,
        },
      });
    }
  };
}

// Helper to create payment for market creation
export const marketCreationPayment: PaymentRequirement = {
  price: '$0.10',
  token: 'cUSD',
  recipient: config.celo.contractAddress || '0x0000000000000000000000000000000000000000',
  description: 'Market creation fee',
};

// Helper to create payment for premium features
export const premiumFeaturePayment: PaymentRequirement = {
  price: '$0.05',
  token: 'cUSD',
  recipient: config.celo.contractAddress || '0x0000000000000000000000000000000000000000',
  description: 'Premium feature access',
};

// Generate x402 payment instructions for WhatsApp users
export function generatePaymentInstructions(requirement: PaymentRequirement): string {
  return `💳 Payment Required: ${requirement.price} ${requirement.token}

To complete this action, send ${requirement.price} to:
${requirement.recipient}

Network: Celo Sepolia (testnet)

After payment, reply "paid" to continue.`;
}
