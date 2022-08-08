import type { DeployFunction } from "hardhat-deploy/types";
import validateUpgrade from "./.utils/validateUpgrade";

const func: DeployFunction = async ({ deployments: { deploy, get }, getNamedAccounts }) => {
  const { deployer } = await getNamedAccounts();
  await validateUpgrade("Previewer", { args: [(await get("Auditor")).address] }, async (name, opts) =>
    deploy(name, {
      ...opts,
      proxy: {
        proxyContract: "ERC1967Proxy",
        proxyArgs: ["{implementation}", "{data}"],
        execute: {
          init: { methodName: "initialize", args: [] },
        },
      },
      from: deployer,
      log: true,
    }),
  );
};

func.tags = ["Previewer"];
func.dependencies = ["Auditor"];

export default func;
