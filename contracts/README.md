# RUKH Governance Token

Rukh Governance Token & DAO contracts.

## Features

-   [Typescript](https://www.typescriptlang.org/)
-   [Ethers v6](https://docs.ethers.org/v6/)
-   [OpenZeppelin Contracts v5.1.0](https://github.com/OpenZeppelin/openzeppelin-contracts/releases/tag/v5.1.0)
-   [Hardhat Verify plugin](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify)
-   [Hardhat Deploy plugin](https://github.com/wighawag/hardhat-deploy)

## Supported Networks

| Network | Chain ID | Documentation |
|---------|----------|---------------|
| Mantle | 5000 | [Documentation](https://docs.mantle.xyz/) |
| Mantle Sepolia | 5003 | [Documentation](https://docs.mantle.xyz/) |

## Contract Verification

| Network | Explorer URL | API URL | API Key Variable |
|---------|--------------|---------|-----------------|
| Mantle | https://explorer.mantle.xyz | https://explorer.mantle.xyz/api | MANTLE_EXPLORER_API_KEY |
| Mantle Sepolia | https://explorer.sepolia.mantle.xyz | https://explorer.sepolia.mantle.xyz/api | MANTLE_EXPLORER_API_KEY |

### Manual Contract Verification

```bash
npx hardhat verify --network <NETWORK_NAME> <CONTRACT_ADDRESS> "10000000000000000000000"
```

Where:
- `<NETWORK_NAME>`: `mantle`, `mantle-sepolia`
- `<CONTRACT_ADDRESS>`: The address where your contract was deployed

## Installation

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment:
```bash
cp .env.template .env
```

3. Update `.env` with your configuration.

## Usage

### Testing

Execute the test suite:
```bash
pnpm test
```

### Deployment

Deploy to supported networks:
```bash
pnpm deploy:<network>
```
Supported values for `<network>`: `mantle`, `mantle-sepolia`

### Network Operations

Check wallet ETH balances:
```bash
pnpm bal
```

Mint tokens:
```bash
pnpm mint:<network> <amount>
```

Transfer tokens:
```bash
pnpm send:<network> <amount>
```

## Core Dependencies

-   Node [v20.9.0](https://nodejs.org/uk/blog/release/v20.9.0/)
-   PNPM [v9.10.0](https://pnpm.io/pnpm-vs-npm)
-   Hardhat [v2.22.16](https://github.com/NomicFoundation/hardhat/releases/)
-   OpenZeppelin Contracts [v5.1.0](https://github.com/OpenZeppelin/openzeppelin-contracts/releases/tag/v5.1.0)
-   Ethers [v6.13.4](https://docs.ethers.org/v6/)

## Feb 11 deployment

```➜ pnpm deploy:mantle-sepolia


> w3hc-hardhat-template@0.1.0 deploy:mantle-sepolia /Users/ju/rukh-contracts
> hardhat deploy --network mantle-sepolia --reset

WARNING: You are currently using Node.js v23.7.0, which is not supported by Hardhat. This can lead to unexpected behavior. See https://hardhat.org/nodejs-versions


Nothing to compile
No need to generate any newer typings.
Deploying RukhGovernanceToken and RukhGovernor to Mantle Sepolia...
Deployer: 0x265E31444C6E279870eB20c15B0547373635840b
deploying "RukhGovernanceToken" (tx: 0x043fb29883adda9ef2d241aec83ec62f5d3c8e797ff832754de601d066eb4c8d)...: deployed at 0x4db173196C37bF4Df60277A843590690F52bEB6a with 6248499908 gas
deploying "RukhGovernor" (tx: 0x37d372fa08bcdc2906a897491588a498efcca833c85f2498534385b79e8b1ac1)...: deployed at 0x446200cB329592134989B615d4C02f9f3c9E970F with 12289240863 gas
RukhGovernanceToken deployed to: 0x4db173196C37bF4Df60277A843590690F52bEB6a
RukhGovernor deployed to: 0x446200cB329592134989B615d4C02f9f3c9E970F

Mantle Explorer verification in progress...
Successfully submitted source code for contract
contracts/RukhGovernanceToken.sol:RukhGovernanceToken at 0x4db173196C37bF4Df60277A843590690F52bEB6a
for verification on the block explorer. Waiting for verification result...

Successfully verified contract RukhGovernanceToken on the block explorer.
https://explorer.sepolia.mantle.xyz/address/0x4db173196C37bF4Df60277A843590690F52bEB6a#code

Successfully verified contract RukhGovernanceToken on Sourcify.
https://repo.sourcify.dev/contracts/full_match/5003/0x4db173196C37bF4Df60277A843590690F52bEB6a/

Successfully submitted source code for contract
contracts/RukhGovernor.sol:RukhGovernor at 0x446200cB329592134989B615d4C02f9f3c9E970F
for verification on the block explorer. Waiting for verification result...

Successfully verified contract RukhGovernor on the block explorer.
https://explorer.sepolia.mantle.xyz/address/0x446200cB329592134989B615d4C02f9f3c9E970F#code

Successfully verified contract RukhGovernor on Sourcify.
https://repo.sourcify.dev/contracts/full_match/5003/0x446200cB329592134989B615d4C02f9f3c9E970F/

Mantle Explorer verification completed ✅
```

## Support

Feel free to reach out to [Julien](https://github.com/julienbrg) on [Farcaster](https://warpcast.com/julien-), [Element](https://matrix.to/#/@julienbrg:matrix.org), [Status](https://status.app/u/iwSACggKBkp1bGllbgM=#zQ3shmh1sbvE6qrGotuyNQB22XU5jTrZ2HFC8bA56d5kTS2fy), [Telegram](https://t.me/julienbrg), [Twitter](https://twitter.com/julienbrg), [Discord](https://discordapp.com/users/julienbrg), or [LinkedIn](https://www.linkedin.com/in/julienberanger/).