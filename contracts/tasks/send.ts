import { task } from "hardhat/config"
import fs from "fs"
import path from "path"
var msg = require("cli-color").xterm(39).bgXterm(128)
var error = require("cli-color").red.bold

task("send", "Send a given amount of tokens to a given address")
    .addParam("wallet")
    .addParam("amount")
    .setAction(async (args, hre) => {
        const ethers = hre.ethers
        const [signer] = await ethers.getSigners()
        const RukhGovernanceToken = await ethers.getContractFactory(
            "RukhGovernanceToken"
        )

        const deploymentPath = path.join(
            __dirname,
            "..",
            "deployments",
            hre.network.name,
            "RukhGovernanceToken.json"
        )

        if (!fs.existsSync(deploymentPath)) {
            console.log(
                error(
                    `\nCan't find a deployed instance of RukhGovernanceToken ERC-20 on ${hre.network.name}`
                ),
                "\nTry deploying it first with:",
                msg(`\npnpm deploy:${hre.network.name}`)
            )
            return
        }

        const deploymentData = JSON.parse(
            fs.readFileSync(deploymentPath, "utf8")
        )
        const addr = deploymentData.address

        const erc20 = new ethers.Contract(
            addr,
            RukhGovernanceToken.interface,
            signer
        )
        const mint = await erc20.transfer(
            args.wallet,
            await ethers.parseEther(args.amount)
        )
        const hash = mint.hash
        console.log(
            "\nSent",
            msg(args.amount),
            "to",
            args.wallet,
            "\n\nTx hash:",
            msg(hash)
        )
    })
