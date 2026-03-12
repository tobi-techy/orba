import { ethers } from "hardhat";

async function main() {
  // Celo Sepolia cUSD address
  const cUsdAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
  
  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const market = await PredictionMarket.deploy(cUsdAddress);
  await market.waitForDeployment();
  
  const address = await market.getAddress();
  console.log("PredictionMarket deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
