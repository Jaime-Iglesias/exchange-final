
const { accounts, contract, web3 } = require('@openzeppelin/test-environment');

const { expect } = require('chai');

const { BN, ether, balance, constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = constants;

const Token = contract.fromArtifact('ERC20');
const Dex = contract.fromArtifact('Dex');

describe('Dex', function () {
    const [initialHolder, owner, user] = accounts;

    // to deploy an ERC20 token
    const name = 'My Token';
    const symbol = 'MTKN';
  
    // 
    const nameInvalid = 'Invalid';
    const symbolInvalid = 'INV';

    const initialSupply = new BN('100');
    const initialBalance = new BN('50');

    const zeroAmount = new BN('0');

    const blockExpiration = new BN('500');

    beforeEach(async function () {
        this.token = await Token.new(name, symbol, initialSupply, { from : initialHolder });

        await this.token.transfer(user, initialBalance, { from : initialHolder });

        this.alternativeToken = await Token.new(name, symbol, initialSupply, { from : initialHolder });

        await this.alternativeToken.transfer(user, initialBalance, { from : initialHolder });

        this.invalidToken = await Token.new(nameInvalid, symbolInvalid, initialSupply, { from : initialHolder });

        this.dex = await Dex.new({ from: owner });
    });

    describe('basic information', function () {
        it('has an owner', async function () {
            expect(await this.dex.isOwner({ from: owner })).to.equal(true);
        });

        it('supports Ether by defaut', async function () {
            expect(await this.dex.getValidTokens()).to.deep.equal([ZERO_ADDRESS]);
        });
    });

    describe('add token', function () {
        const sender = user;

        context('sender is not the owner', function () {
            it('reverts', async function () {
                await expectRevert(
                    this.dex.addToken(this.token.address, { from: sender }),
                    'Ownable: caller is not the owner'
                );
            });
        });

        context('sender is the owner', function () {
            const sender = owner;

            context('the token has not already been added', function () {
                it('adds the token', async function () {
                    await this.dex.addToken(this.token.address, { from: sender });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(true);
                });

                it('emits a TokenAdded event', async function () {
                    const receipt = await this.dex.addToken(this.token.address, {from : sender });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(true);

                    expectEvent(receipt, 'TokenAdded', { token: this.token.address });
                });
            });

            context('the token has already been added', function () {
                beforeEach(async function () {
                    await this.dex.addToken(this.token.address, { from: sender });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(true);
                });

                it('reverts', async function () {
                    await expectRevert(
                        this.dex.addToken(this.token.address, { from: sender }),
                        'this token has already been added'
                    );
                });
            });
        });
    });

    describe('remove token', function () {
        context('sender is not the owner', function () {
            const sender = user;

            it('reverts', async function () {
                await expectRevert(
                    this.dex.removeToken(this.token.address, { from: sender }),
                    'Ownable: caller is not the owner'
                );
            });
        });

        context('sender is the owner', function () {
            const sender = owner;

            context('the token has not already been added', function () {
                it('reverts', async function () {
                    await expectRevert(
                        this.dex.removeToken(this.token.address, { from: sender }),
                        'this token has not been added yet'
                    );
                });
            });

            context('the token has already been added', function () {
                beforeEach(async function () {
                    await this.dex.addToken(this.token.address, { from: sender });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(true);
                });

                it('removes the token', async function () {
                    await this.dex.removeToken(this.token.address, { from: sender });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(false);
                });

                it('emits a TokenRemoved event', async function () {
                    const receipt = await this.dex.removeToken(this.token.address, { from: sender });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(false);

                    expectEvent(receipt, 'TokenRemoved', { token: this.token.address });
                });
            });
        });
    });

    describe('despoit', function () {
        const depositAmount = new BN('5');

        it('escrows ETH into the contract', async function () {
            await this.dex.deposit({ from: user, value: depositAmount });

            const userBalance = await this.dex.userBalanceForToken(ZERO_ADDRESS, { from: user });

            expect(userBalance.available).to.be.bignumber.equal(depositAmount);
            expect(userBalance.locked).to.be.bignumber.equal(zeroAmount);
        });

        it('emits a TokensDeposited event', async function () {
            const receipt = await this.dex.deposit({ from: user, value: depositAmount });

            expectEvent(
                receipt, 
                'TokensDeposited', 
                { depositer : user, token : ZERO_ADDRESS, amount: depositAmount }
            );
        });
    });

    describe('withdraw', function () {
        const withdrawAmount = new BN('5');

        context('user does not have enough available balance', function () {
            it('reverts', async function () {
                await expectRevert(
                    this.dex.withdraw(withdrawAmount, { from: user }),
                    'not enough balance available'
                );
            });
        });

        context('user has enough balance available', function () {
            beforeEach(async function () {
                await this.dex.deposit({ from: user, value: withdrawAmount });
            });

            it('withdraws the amount', async function () {
                const userBalancePre = await this.dex.userBalanceForToken(ZERO_ADDRESS, { from: user });

                expect(userBalancePre.available).to.be.bignumber.equal(withdrawAmount);
                expect(userBalancePre.locked).to.be.bignumber.equal(zeroAmount);

                await this.dex.withdraw(withdrawAmount, { from : user });

                const userBalancePost = await this.dex.userBalanceForToken(ZERO_ADDRESS, { from: user });

                expect(userBalancePost.available).to.be.bignumber.equal(zeroAmount);
                expect(userBalancePost.locked).to.be.bignumber.equal(zeroAmount);
            });

            it('emits a TokensWithdrawed event', async function () {
                const receipt = await this.dex.withdraw(withdrawAmount, { from : user });

                expectEvent(
                    receipt,
                    'TokensWithdrawed',
                    { withdrawer : user, token : ZERO_ADDRESS, amount: withdrawAmount }
                );
            });
        });
    });

    describe('deposit token', function () {
        const sender = user;
        const depositAmount = initialBalance;

        context('token is the zero address', function () {
            it ('reverts', async function () {
                await expectRevert(
                    this.dex.depositToken(ZERO_ADDRESS, depositAmount, { from : sender }),
                    'address cannot be the 0 address'
                );
            });

        });

        context('token is not the zero address', function () {
            context('token is not valid', function () {
                it('reverts', async function () {
                    await expectRevert(
                        this.dex.depositToken(this.invalidToken.address, depositAmount, { from : sender }),
                        'token is not valid'
                    );
                });
            });

            context('token is valid', function () {
                beforeEach(async function () {
                    await this.dex.addToken(this.token.address, {from : owner });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(true);
                });

                context('user does not have enough tokens', function () {
                    const depositAmount = initialBalance + 1;

                    it('reverts', async function () { 
                        await expectRevert(
                            this.dex.depositToken(this.token.address, depositAmount, { from : sender }),
                            'ERC20: transfer amount exceeds balance'
                        );
                    });

                });

                context('user has enough tokens', function () {
                    context('user does not have enough allowance', function () {
                        it('reverts', async function () {
                            await expectRevert(
                                this.dex.depositToken(this.token.address, depositAmount, { from : sender }),
                                'ERC20: transfer amount exceeds allowance'
                            );
                        });
                    });

                    context('user has enough allowance', function () {
                        beforeEach(async function () {
                            await this.token.approve(this.dex.address, depositAmount, { from : sender });
                        });

                        it('deposits the tokens', async function () {
                            await this.dex.depositToken(this.token.address, depositAmount, { from : sender });

                            const userBalance = await this.dex.userBalanceForToken(this.token.address, { from : sender });

                            expect(userBalance.available).to.be.bignumber.equal(depositAmount);
                            expect(userBalance.locked).to.be.bignumber.equal(zeroAmount);
                            
                            expect(await this.token.balanceOf(sender)).to.be.bignumber.equal(zeroAmount);
                        });

                        it('emits the TokensDeposited event', async function () {
                            const receipt = await this.dex.depositToken(this.token.address, depositAmount, { from : sender });

                            expectEvent(
                                receipt, 
                                'TokensDeposited', 
                                { depositer : sender, token : this.token.address, amount: depositAmount }
                            );

                        });
                    });
                });
            });
        });
    });

    describe('withdraw token', function () {
        const sender = user;
        const withdrawAmount = initialBalance;

        context('token is the zero address', function () {
            const token = ZERO_ADDRESS;

            it('reverts', async function () {
                await expectRevert(
                    this.dex.withdrawToken(token, withdrawAmount, { from : sender }),
                    'address cannot be the 0 address'
                );
            });
        });

        context('token is not the zero address', function () {
            context('token is not valid', function () {
                it('reverts', async function () {
                    await expectRevert(
                        this.dex.withdrawToken(this.invalidToken.address, withdrawAmount, { from : sender }),
                        'token is not valid'
                    );
                });
            });

            context('token is valid', function () {
                beforeEach(async function () {
                    await this.dex.addToken(this.token.address, {from : owner });

                    expect(await this.dex.isValidToken(this.token.address)).to.equal(true);
                });

                context('sender does not enough unlocked tokens', function () {
                    const withdrawAmount = initialBalance.add(new BN('1'));

                    it('reverts', async function () {
                        await expectRevert(
                            this.dex.withdrawToken(this.token.address, withdrawAmount, { from : sender }),
                            'not enough balance available'
                        );
                    });
                });

                context('sender has enough unlocked tokens', function () {
                    const withdrawAmount = initialBalance;

                    beforeEach(async function () {
                        await this.token.approve(this.dex.address, withdrawAmount, { from : sender });

                        await this.dex.depositToken(this.token.address, withdrawAmount, { from : sender });
                        
                        const balance = await this.dex.userBalanceForToken(this.token.address);

                        expect(balance[0]).to.be.bignumber.equal('0');
                    });

                    it('returns the tokens to the sender', async function () {
                        await this.dex.withdrawToken(this.token.address, withdrawAmount, { from : sender });

                        expect(await this.token.balanceOf(sender)).to.be.bignumber.equal(withdrawAmount);
                    });

                    it('updates the internal balance for sender', async function () {
                        await this.dex.withdrawToken(this.token.address, withdrawAmount, { from : sender });

                        const balance = await this.dex.userBalanceForToken(this.token.address);

                        expect(balance[0]).to.be.bignumber.equal('0');
                    });
                });
            });
        });
    });

    describe('createOrder', function () {
        const sender = user;
        const haveAmount = new BN('10');
        const wantAmount = new BN('5');

        context('haven token is invalid', function () {
            it('reverts', async function () {
                const haveToken = this.token.address;
                const wantToken = this.alternativeToken.address;

                await expectRevert(
                    this.dex.createOrder(
                        haveToken,
                        haveAmount,
                        wantToken,
                        wantAmount,
                        { from : sender }
                    ),
                    'token is not valid'
                );
            });
        });

        context('want token is invalid', function () {
            it('reverts', async function () {
                const haveToken = ZERO_ADDRESS;
                const wantToken = this.alternativeToken.address;

                await expectRevert(
                    this.dex.createOrder(
                        haveToken,
                        haveAmount,
                        wantToken,
                        wantAmount,
                        { from : sender }
                    ),
                    'token is not valid'
                );
            });
        });
        
        context('both tokens are valid', function () {
            beforeEach(async function () {
                await this.dex.addToken(this.token.address, { from: owner });

                expect(await this.dex.isValidToken(this.token.address)).to.equal(true); 
            });

            context('have token is Ether', function () {
                const haveToken = ZERO_ADDRESS;

                context('sender does not have enough escrowed balance', function () {
                    context('sender did not include Ether in the transaction', function () {
                        it('reverts', async function () {
                            
                            const wantToken = this.token.address;

                            await expectRevert(
                                this.dex.createOrder(
                                    haveToken,
                                    haveAmount,
                                    wantToken,
                                    wantAmount,
                                    { from : sender } 
                                ),
                                'Ether: Not enough balance'
                            )

                        });
                    });

                    context('sender included more Ether in the transaction', function () {
                        it('creates a new order', async function () {
                            const wantToken = this.token.address;

                            await this.dex.createOrder(
                                haveToken,
                                haveAmount,
                                wantToken,
                                wantAmount,
                                { from : sender, value : haveAmount } 
                            );

                            const nonce = new BN('1');
                            const block = await time.latestBlock();
                            const blockNumber = new BN(block).add(blockExpiration);

                            const orderHash = web3.utils.soliditySha3(
                                haveToken,
                                haveAmount,
                                wantToken,
                                wantAmount,
                                sender,
                                nonce,
                                blockNumber
                            );

                            expect(await this.dex.orderExists(sender, orderHash)).to.equal(true);
                        });

                        it('updates the user escrowed balance', async function () {
                            const wantToken = this.token.address;

                            await this.dex.createOrder(
                                haveToken,
                                haveAmount,
                                wantToken,
                                wantAmount,
                                { from : sender, value : haveAmount } 
                            );

                            const userBalance = await this.dex.userBalanceForToken(haveToken, { from : sender });

                            expect(userBalance.available).to.be.bignumber.equal(new BN('0'));
                            expect(userBalance.locked).to.be.bignumber.equal(haveAmount);
                        });

                        it('uses the included ether as balance', async function () {
                            const wantToken = this.token.address;

                            const tracker = await balance.tracker(sender, 'ether');

                            await this.dex.createOrder(
                                haveToken,
                                haveAmount,
                                wantToken,
                                wantAmount,
                                { from : sender, value : haveAmount } 
                            );

                            expect(await tracker.delta()).to.be.bignumber.equal(haveAmount);
                        });

                        it('order fill is `0` by default', async function () {
                            
                        });

                        it('emits an OrderCreated event', async function () {
                            
                        });
                    });
                });

                context('sender has enough escrowed blance', function () {
                    
                });
            });

            context('have token is ERC20', function () {
                
            });
        });
    });

});
