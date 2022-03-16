import type { DeployFunction } from "hardhat-deploy/types";
import type {
  Auditor,
  ERC20,
  EToken,
  ExactlyOracle,
  FixedLender,
  InterestRateModel,
  PoolAccounting,
  TimelockController,
} from "../types";
import transferOwnership from "./.utils/transferOwnership";
import executeOrPropose from "./.utils/executeOrPropose";
import grantRole from "./.utils/grantRole";

const func: DeployFunction = async ({
  config: {
    finance: { collateralFactor },
  },
  ethers: {
    constants: { AddressZero },
    utils: { parseUnits },
    getContract,
    getSigner,
  },
  network: { config },
  deployments: { deploy, get },
  getNamedAccounts,
}) => {
  const [auditor, exactlyOracle, interestRateModel, timelockController, { deployer, multisig }] = await Promise.all([
    getContract<Auditor>("Auditor"),
    getContract<ExactlyOracle>("ExactlyOracle"),
    getContract<InterestRateModel>("InterestRateModel"),
    getContract<TimelockController>("TimelockController"),
    getNamedAccounts(),
  ]);

  for (const token of config.tokens) {
    const [{ address: tokenAddress }, tokenContract] = await Promise.all([get(token), getContract<ERC20>(token)]);
    const [symbol, decimals] = await Promise.all([tokenContract.symbol(), tokenContract.decimals()]);

    const eTokenName = `EToken${symbol}`;
    await deploy(eTokenName, {
      contract: "EToken",
      args: [`e${symbol}`, `e${symbol}`, decimals],
      from: deployer,
      log: true,
    });
    const eToken = await getContract<EToken>(eTokenName, await getSigner(deployer));

    const poolAccountingName = `PoolAccounting${symbol}`;
    await deploy(poolAccountingName, {
      contract: "PoolAccounting",
      args: [interestRateModel.address],
      from: deployer,
      log: true,
    });
    const poolAccounting = await getContract<PoolAccounting>(poolAccountingName, await getSigner(deployer));

    const fixedLenderName = `FixedLender${symbol}`;
    await deploy(fixedLenderName, {
      contract: symbol === "WETH" ? "ETHFixedLender" : "FixedLender",
      args: [tokenAddress, token, eToken.address, auditor.address, poolAccounting.address],
      from: deployer,
      log: true,
    });
    const fixedLender = await getContract<FixedLender>(fixedLenderName);

    if ((await eToken.fixedLender()) === AddressZero || (await eToken.auditor()) === AddressZero) {
      await eToken.initialize(fixedLender.address, auditor.address);
    }

    if ((await poolAccounting.fixedLenderAddress()) === AddressZero) {
      await executeOrPropose(deployer, timelockController, poolAccounting, "initialize", [fixedLender.address]);
    }

    const underlyingCollateralFactor = parseUnits(String(collateralFactor[token] ?? collateralFactor.default));
    if (!(await auditor.getMarketAddresses()).includes(fixedLender.address)) {
      await executeOrPropose(deployer, timelockController, auditor, "enableMarket", [
        fixedLender.address,
        underlyingCollateralFactor,
        symbol,
        token,
        decimals,
      ]);
    } else if (!(await auditor.getMarketData(fixedLender.address))[3].eq(underlyingCollateralFactor)) {
      await executeOrPropose(deployer, timelockController, auditor, "setCollateralFactor", [
        fixedLender.address,
        underlyingCollateralFactor,
      ]);
    }

    await grantRole(fixedLender, await fixedLender.PAUSER_ROLE(), multisig);

    for (const contract of [eToken, poolAccounting, fixedLender]) {
      await transferOwnership(contract, deployer, timelockController.address);
    }
  }

  for (const contract of [auditor, interestRateModel, exactlyOracle]) {
    await transferOwnership(contract, deployer, timelockController.address);
  }
};

func.tags = ["Markets"];
func.dependencies = ["Auditor", "ExactlyOracle", "InterestRateModel", "TimelockController", "Tokens"];

export default func;
