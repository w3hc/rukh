import '@nomiclabs/hardhat-ethers';
import color from 'cli-color';
var msg = color.xterm(39).bgXterm(128);
import hre, { ethers } from 'hardhat';

export default async ({ getNamedAccounts, deployments }: any) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log(
    'Deploying RukhGovernanceToken and RukhGovernor to Arbitrum Sepolia...',
  );
  console.log('Deployer:', deployer);

  const rukhToken = await deploy('RukhGovernanceToken', {
    from: deployer,
    args: [deployer],
    log: true,
  });

  const rukhGovernor = await deploy('RukhGovernor', {
    from: deployer,
    args: [rukhToken.address],
    log: true,
  });

  if (hre.network.name === 'arbitrum-sepolia') {
    try {
      console.log('RukhGovernanceToken deployed to:', msg(rukhToken.address));
      console.log('RukhGovernor deployed to:', msg(rukhGovernor.address));

      console.log('\nArbitrum Explorer verification in progress...');

      await new Promise((resolve) => setTimeout(resolve, 30 * 1000));

      await hre.run('verify:verify', {
        address: rukhToken.address,
        constructorArguments: [deployer],
      });

      await hre.run('verify:verify', {
        address: rukhGovernor.address,
        constructorArguments: [rukhToken.address],
      });

      console.log('Arbitrum Explorer verification completed ✅');
    } catch (error) {
      console.error('Error during verification:', error);
    }
  } else {
    console.log('Not on Arbitrum Sepolia - skipping verification');
  }
};

export const tags = ['RukhGovernance'];
