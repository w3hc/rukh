import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import "@nomicfoundation/hardhat-verify"
import "hardhat-deploy"
import * as dotenv from "dotenv"
dotenv.config()

const {
    SIGNER_PRIVATE_KEY,
    MANTLE_SEPOLIA_RPC_ENDPOINT_URL,
    MANTLE_EXPLORER_API_KEY
} = process.env

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    namedAccounts: {
        deployer: 0
    },
    networks: {
        hardhat: {
            chainId: 1337,
            allowUnlimitedContractSize: true
        },
        "mantle-sepolia": {
            chainId: 5003,
            url:
                MANTLE_SEPOLIA_RPC_ENDPOINT_URL ||
                "https://rpc.sepolia.mantle.xyz",
            accounts:
                SIGNER_PRIVATE_KEY !== undefined ? [SIGNER_PRIVATE_KEY] : []
        }
    },
    solidity: {
        version: "0.8.22",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    sourcify: {
        enabled: true
    },
    etherscan: {
        apiKey: {
            "mantle-sepolia": MANTLE_EXPLORER_API_KEY || ""
        },
        customChains: [
            {
                network: "mantle-sepolia",
                chainId: 5003,
                urls: {
                    apiURL: "https://explorer.sepolia.mantle.xyz/api",
                    browserURL: "https://explorer.sepolia.mantle.xyz"
                }
            }
        ]
    }
}

export default config
