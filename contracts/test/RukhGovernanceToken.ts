import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"

describe("RukhGovernanceToken", function () {
    async function deployContracts() {
        const [owner, alice, bob] = await ethers.getSigners()
        const RukhGovernanceToken = await ethers.getContractFactory(
            "RukhGovernanceToken"
        )
        const token = await RukhGovernanceToken.deploy(owner.address)
        return { token, owner, alice, bob }
    }

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            const { token, owner } = await loadFixture(deployContracts)
            expect(await token.owner()).to.equal(owner.address)
        })

        it("Should have correct name and symbol", async function () {
            const { token } = await loadFixture(deployContracts)
            expect(await token.name()).to.equal("RukhGovernanceToken")
            expect(await token.symbol()).to.equal("RUKH")
        })

        it("Should start with zero total supply", async function () {
            const { token } = await loadFixture(deployContracts)
            expect(await token.totalSupply()).to.equal(0)
        })
    })

    describe("Minting", function () {
        it("Should allow owner to mint tokens", async function () {
            const { token, alice } = await loadFixture(deployContracts)
            const mintAmount = ethers.parseEther("100")
            await token.mint(alice.address, mintAmount)
            expect(await token.balanceOf(alice.address)).to.equal(mintAmount)
        })

        it("Should not allow non-owner to mint tokens", async function () {
            const { token, alice, bob } = await loadFixture(deployContracts)
            const mintAmount = ethers.parseEther("100")
            await expect(
                token.connect(alice).mint(bob.address, mintAmount)
            ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        })
    })

    describe("ERC20Votes", function () {
        it("Should track voting power after delegation", async function () {
            const { token, alice, bob } = await loadFixture(deployContracts)
            const amount = ethers.parseEther("100")

            // Mint tokens to Alice
            await token.mint(alice.address, amount)

            // Alice delegates to Bob
            await token.connect(alice).delegate(bob.address)

            // Check Bob's voting power
            expect(await token.getVotes(bob.address)).to.equal(amount)
        })

        it("Should track voting power historically", async function () {
            const { token, alice } = await loadFixture(deployContracts)
            const amount = ethers.parseEther("0")

            // Mint tokens to Alice
            await token.mint(alice.address, amount)

            // Alice self-delegates
            await token.connect(alice).delegate(alice.address)

            // Move one block forward
            await ethers.provider.send("evm_mine", [])

            // Get the current block number
            const blockNumber = await ethers.provider.getBlockNumber()

            // Check historical voting power
            expect(
                await token.getPastVotes(alice.address, blockNumber - 1)
            ).to.equal(amount)
        })
    })

    describe("Burning", function () {
        it("Should allow token holders to burn their tokens", async function () {
            const { token, alice } = await loadFixture(deployContracts)
            const amount = ethers.parseEther("100")

            // Mint tokens to Alice
            await token.mint(alice.address, amount)

            // Alice burns half her tokens
            await token.connect(alice).burn(amount / 2n)

            expect(await token.balanceOf(alice.address)).to.equal(amount / 2n)
        })
    })

    describe("ERC20Permit", function () {
        it("Should allow permit functionality", async function () {
            const { token, owner, alice } = await loadFixture(deployContracts)
            const amount = ethers.parseEther("100")

            // Get the current nonce
            const nonce = await token.nonces(owner.address)

            // Get the EIP712 domain separator
            const domain = {
                name: await token.name(),
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await token.getAddress()
            }

            // Create the permit type data
            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            }

            const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now

            const value = {
                owner: owner.address,
                spender: alice.address,
                value: amount,
                nonce: nonce,
                deadline: deadline
            }

            // Sign the permit
            const signature = await owner.signTypedData(domain, types, value)
            const sig = ethers.Signature.from(signature)

            // Execute the permit
            await token.permit(
                owner.address,
                alice.address,
                amount,
                deadline,
                sig.v,
                sig.r,
                sig.s
            )

            // Check the allowance
            expect(
                await token.allowance(owner.address, alice.address)
            ).to.equal(amount)
        })
    })
})
