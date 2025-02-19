import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import 'hardhat-deploy';
import * as dotenv from 'dotenv';
dotenv.config();

const {
  SIGNER_PRIVATE_KEY,
  ARBITRUM_SEPOLIA_RPC_ENDPOINT_URL,
  ARBITRUM_ETHERSCAN_API_KEY,
} = process.env;

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  namedAccounts: {
    deployer: 0,
  },
  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: true,
    },
    'arbitrum-sepolia': {
      chainId: 421614,
      url: ARBITRUM_SEPOLIA_RPC_ENDPOINT_URL || 'https://sepolia.arbiscan.io',
      accounts: SIGNER_PRIVATE_KEY !== undefined ? [SIGNER_PRIVATE_KEY] : [],
    },
  },
  solidity: {
    version: '0.8.22',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  sourcify: {
    enabled: true,
  },
  etherscan: {
    apiKey: {
      'arbitrum-sepolia': ARBITRUM_ETHERSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'arbitrum-sepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io',
        },
      },
    ],
  },
};

export default config;
