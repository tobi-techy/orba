import { ethers } from "hardhat";

async function main() {
  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const market = await PredictionMarket.deploy();
  await market.waitForDeployment();
  console.log("PredictionMarket deployed to:", await market.getAddress());
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
