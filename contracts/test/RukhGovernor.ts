// test/RukhGovernor.ts
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"

describe("RukhGovernor", function () {
    async function deployContracts() {
        const [owner, voter1, voter2] = await ethers.getSigners()

        // Deploy Token
        const RukhGovernanceToken = await ethers.getContractFactory(
            "RukhGovernanceToken"
        )
        const token = await RukhGovernanceToken.deploy(owner.address)

        // Deploy Governor
        const RukhGovernor = await ethers.getContractFactory("RukhGovernor")
        const governor = await RukhGovernor.deploy(await token.getAddress())

        // Mint some tokens to voters
        const mintAmount = ethers.parseEther("100")
        await token.mint(voter1.address, mintAmount)
        await token.mint(voter2.address, mintAmount)

        return { token, governor, owner, voter1, voter2, mintAmount }
    }

    describe("Deployment", function () {
        it("Should set the correct token address", async function () {
            const { token, governor } = await loadFixture(deployContracts)
            expect(await governor.token()).to.equal(await token.getAddress())
        })

        it("Should set the correct voting delay", async function () {
            const { governor } = await loadFixture(deployContracts)
            expect(await governor.votingDelay()).to.equal(24 * 60 * 60) // 1 day in seconds
        })

        it("Should set the correct voting period", async function () {
            const { governor } = await loadFixture(deployContracts)
            expect(await governor.votingPeriod()).to.equal(7 * 24 * 60 * 60) // 1 week in seconds
        })

        it("Should set the correct proposal threshold", async function () {
            const { governor } = await loadFixture(deployContracts)
            expect(await governor.proposalThreshold()).to.equal(
                ethers.parseEther("10")
            )
        })
    })

    describe("Governance Settings", function () {
        it("Should not allow non-voters to make proposals", async function () {
            const { governor, owner } = await loadFixture(deployContracts)

            const proposalData = {
                targets: [owner.address],
                values: [0],
                calldatas: ["0x"],
                description: "Test Proposal"
            }

            // Owner has no tokens, so shouldn't be able to propose
            await expect(
                governor.propose(
                    proposalData.targets,
                    proposalData.values,
                    proposalData.calldatas,
                    proposalData.description
                )
            ).to.be.revertedWithCustomError(
                governor,
                "GovernorInsufficientProposerVotes"
            )
        })

        it("Should enforce the proposal threshold", async function () {
            const { governor, token, voter1 } =
                await loadFixture(deployContracts)

            // Delegate to self to activate voting power
            await token.connect(voter1).delegate(voter1.address)

            const proposalData = {
                targets: [voter1.address],
                values: [0],
                calldatas: ["0x"],
                description: "Test Proposal"
            }

            // Voter has enough tokens but needs to wait for voting delay
            const tx = await governor
                .connect(voter1)
                .propose(
                    proposalData.targets,
                    proposalData.values,
                    proposalData.calldatas,
                    proposalData.description
                )

            expect(tx).to.emit(governor, "ProposalCreated")
        })
    })
})
