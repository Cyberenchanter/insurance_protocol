import hre from "hardhat";
const ethers = hre.ethers;

async function main() {
  const LowLevelCaller = await ethers.getContractFactory("LowLevelCaller");
  const low_level_caller = await LowLevelCaller.deploy();
  console.log("Contract Deployed to Address:", low_level_caller.address);
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
