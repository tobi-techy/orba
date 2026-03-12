import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    celoSepolia: {
      url: "https://alfajores-forno.celo-testnet.org",
      accounts: PRIVATE_KEY && PRIVATE_KEY.length === 66 ? [PRIVATE_KEY] : [],
      chainId: 44787,
    },
  },
};

export default config;
