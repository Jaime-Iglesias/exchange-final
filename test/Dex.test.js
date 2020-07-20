const { verifyExpectedBalance } = require('./utils/utils.js')

const { expect } = require('chai');

const { BN, ether, balance, constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = constants;

const Token = artifacts.require('ERC20');
const Dex = artifacts.require('Dex');

contract('Dex', function (accounts) {
    const [initialHolder, owner, user, user2] = accounts;

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

        await this.token.transfer(user2, initialBalance, { from : initialHolder });

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

    describe('create order', function () {
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
                            );

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
                                { from : sender, value : haveAmount.add(new BN('1')) } 
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

                            expect(await this.dex.orderExists(orderHash)).to.equal(true);
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

                        it('order fill is `0` by default', async function () {
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

                            expect(await this.dex.getOrderFill(orderHash)).to.be.bignumber.equal('0');

                        });

                        it('emits an OrderCreated event', async function () {
                            const wantToken = this.token.address;

                            const receipt = await this.dex.createOrder(
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

                            expectEvent(
                                receipt, 
                                'OrderCreated', 
                                { 
                                    orderHash : orderHash,
                                    haveToken : haveToken, 
                                    haveAmount : haveAmount, 
                                    wantToken: wantToken, 
                                    wantAmount : wantAmount, 
                                    creator : sender, 
                                    nonce : nonce, 
                                    expirationBlock : blockNumber
                                }
                            );
                        });
                    });
                });

                context('sender has enough escrowed balance', function () {
                    beforeEach(async function () {
                        await this.dex.deposit({ from: user, value: haveAmount });

                        const userBalance = await this.dex.userBalanceForToken(ZERO_ADDRESS, { from: user });
            
                        expect(userBalance.available).to.be.bignumber.equal(haveAmount);
                        expect(userBalance.locked).to.be.bignumber.equal(zeroAmount);
                    });

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

                        expect(await this.dex.orderExists(orderHash)).to.equal(true);
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

                    it('order fill is `0` by default', async function () {
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

                        expect(await this.dex.getOrderFill(orderHash)).to.be.bignumber.equal('0');

                    });

                    it('emits an OrderCreated event', async function () {
                        const wantToken = this.token.address;

                        const receipt = await this.dex.createOrder(
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

                        expectEvent(
                            receipt, 
                            'OrderCreated', 
                            { 
                                orderHash : orderHash,
                                haveToken : haveToken, 
                                haveAmount : haveAmount, 
                                wantToken: wantToken, 
                                wantAmount : wantAmount, 
                                creator : sender, 
                                nonce : nonce, 
                                expirationBlock : blockNumber
                            }
                        );
                    });
                });
            });

            context('have token is ERC20', function () {
                const wantToken = ZERO_ADDRESS;
                
                context('sender included Ether in the transaction', function () {
                    it('reverts', async function () {
                        const haveToken = this.token.address;

                        await expectRevert(
                            this.dex.createOrder(
                                haveToken,
                                haveAmount,
                                wantToken,
                                wantAmount,
                                { from : sender, value : 1 } 
                            ),
                            'contract does not take ETH'
                        );
                    });
                });

                context('sender does not have enough scrowed balance', function () {
                    context('sender did not approve the contract', function () {
                        it('reverts', async function () {
                            const haveToken = this.token.address;
    
                            await expectRevert(
                                this.dex.createOrder(
                                    haveToken,
                                    haveAmount,
                                    wantToken,
                                    wantAmount,
                                    { from : sender }
                                ),
                                'ERC20: transfer amount exceeds allowance'
                            );
                        });
                    });
    
                    context('sender approved the contract', function () {
                        beforeEach(async function () {
                            await this.token.approve(this.dex.address, haveAmount, { from : sender });
                        });

                        context('sender does not own enough tokens', function () {
                            const haveAmount = initialBalance.add(new BN('1'));

                            it('reverts', async function () {
                                const haveToken = this.token.address;
    
                                await expectRevert(
                                    this.dex.createOrder(
                                        haveToken,
                                        haveAmount,
                                        wantToken,
                                        wantAmount,
                                        { from : sender }
                                    ),
                                    'ERC20: transfer amount exceeds balance'
                                );
                            });
                        });

                        context('sender owns enough tokens', function () {
                            it('creates a new order', async function () {   
                                const haveToken = this.token.address;

                                await this.dex.createOrder(
                                    haveToken,
                                    haveAmount,
                                    wantToken,
                                    wantAmount,
                                    { from : sender } 
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
        
                                expect(await this.dex.orderExists(orderHash)).to.equal(true);
                            });
        
                            it('updates the user escrowed balance', async function () {
                                const haveToken = this.token.address;

                                await this.dex.createOrder(
                                    haveToken,
                                    haveAmount,
                                    wantToken,
                                    wantAmount,
                                    { from : sender } 
                                );
        
                                const userBalance = await this.dex.userBalanceForToken(haveToken, { from : sender });
        
                                expect(userBalance.available).to.be.bignumber.equal(new BN('0'));
                                expect(userBalance.locked).to.be.bignumber.equal(haveAmount);
                            });
        
                            it('order fill is `0` by default', async function () {
                                const haveToken = this.token.address;

                                await this.dex.createOrder(
                                    haveToken,
                                    haveAmount,
                                    wantToken,
                                    wantAmount,
                                    { from : sender } 
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
        
                                expect(await this.dex.getOrderFill(orderHash)).to.be.bignumber.equal('0');
        
                            });
        
                            it('emits an OrderCreated event', async function () {
                                const haveToken = this.token.address;

                                const receipt = await this.dex.createOrder(
                                    haveToken,
                                    haveAmount,
                                    wantToken,
                                    wantAmount,
                                    { from : sender } 
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
        
                                expectEvent(
                                    receipt, 
                                    'OrderCreated', 
                                    { 
                                        orderHash : orderHash,
                                        haveToken : haveToken, 
                                        haveAmount : haveAmount, 
                                        wantToken: wantToken, 
                                        wantAmount : wantAmount, 
                                        creator : sender, 
                                        nonce : nonce, 
                                        expirationBlock : blockNumber
                                    }
                                );
                            });
                        });
                    });
                });

                context('sender has enough escrowed balance', function () {
                    beforeEach(async function () {
                        await this.token.approve(this.dex.address, haveAmount, { from : sender });

                        await this.dex.depositToken(this.token.address, haveAmount, { from : sender });

                        const userBalance = await this.dex.userBalanceForToken(this.token.address, { from : sender });

                        expect(userBalance.available).to.be.bignumber.equal(haveAmount);
                        expect(userBalance.locked).to.be.bignumber.equal(zeroAmount);
                    });

                    it('creates a new order', async function () {   
                        const haveToken = this.token.address;

                        await this.dex.createOrder(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            { from : sender } 
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

                        expect(await this.dex.orderExists(orderHash)).to.equal(true);
                    });

                    it('updates the user escrowed balance', async function () {
                        const haveToken = this.token.address;

                        await this.dex.createOrder(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            { from : sender } 
                        );

                        const userBalance = await this.dex.userBalanceForToken(haveToken, { from : sender });

                        expect(userBalance.available).to.be.bignumber.equal(new BN('0'));
                        expect(userBalance.locked).to.be.bignumber.equal(haveAmount);
                    });

                    it('order fill is `0` by default', async function () {
                        const haveToken = this.token.address;

                        await this.dex.createOrder(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            { from : sender } 
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

                        expect(await this.dex.getOrderFill(orderHash)).to.be.bignumber.equal('0');

                    });

                    it('emits an OrderCreated event', async function () {
                        const haveToken = this.token.address;

                        const receipt = await this.dex.createOrder(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            { from : sender } 
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

                        expectEvent(
                            receipt, 
                            'OrderCreated', 
                            { 
                                orderHash : orderHash,
                                haveToken : haveToken, 
                                haveAmount : haveAmount, 
                                wantToken: wantToken, 
                                wantAmount : wantAmount, 
                                creator : sender, 
                                nonce : nonce, 
                                expirationBlock : blockNumber
                            }
                        );
                    });
                });
            });
        });
    });

    describe('cancel order', function () {
        const haveToken = ZERO_ADDRESS;
        const sender = user;
        const haveAmount = new BN('10');
        const wantAmount = new BN('5');
        const nonce = new BN('1');
        const creator = user;
        let expirationBlock;

        context('order does not exist', function () {
            it('reverts', async function () {
                const wantToken = this.token.address;
                const block = await time.latestBlock();
                const expirationBlock = new BN(block).add(blockExpiration);
                
                const orderHash = web3.utils.soliditySha3(
                    haveToken,
                    haveAmount,
                    wantToken,
                    wantAmount,
                    sender,
                    nonce,
                    expirationBlock
                );

                await expectRevert(
                    this.dex.cancelOrder(orderHash, { from : sender }),
                    'Order does not exist'
                );
            });
        });

        context('order exists', function () {
            beforeEach(async function () {
                // add token
                await this.dex.addToken(this.token.address, { from: owner });

                expect(await this.dex.isValidToken(this.token.address)).to.equal(true); 

                // escrow tokens
                await this.dex.deposit({ from: user, value: haveAmount });

                const userBalance = await this.dex.userBalanceForToken(ZERO_ADDRESS, { from: user });
    
                expect(userBalance.available).to.be.bignumber.equal(haveAmount);
                expect(userBalance.locked).to.be.bignumber.equal(zeroAmount);

                // create order
                const wantToken = this.token.address;

                await this.dex.createOrder(
                    haveToken,
                    haveAmount,
                    wantToken,
                    wantAmount,
                    { from : sender } 
                );

                const block = await time.latestBlock();
                expirationBlock = new BN(block).add(blockExpiration);

                const orderHash = web3.utils.soliditySha3(
                    haveToken,
                    haveAmount,
                    wantToken,
                    wantAmount,
                    creator,
                    nonce,
                    expirationBlock
                );

                expect(await this.dex.orderExists(orderHash)).to.equal(true);
            });

            context('sender is not the order creator', function () {
                const sender = owner;

                it('reverts', async function () {
                    const wantToken = this.token.address;

                    const orderHash = web3.utils.soliditySha3(
                        haveToken,
                        haveAmount,
                        wantToken,
                        wantAmount,
                        creator,
                        nonce,
                        expirationBlock
                    );
    
                    await expectRevert(
                        this.dex.cancelOrder(orderHash, { from : sender }),
                        'sender is not the order creator'
                    );
                });
            });

            context('sender is the order creator', function () {
                const sender = user;

                context('order has not already been canceled', function () {
                    it('cancels the order', async function () {
                        const wantToken = this.token.address;
    
                        const orderHash = web3.utils.soliditySha3(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            creator,
                            nonce,
                            expirationBlock
                        );
        
                        await this.dex.cancelOrder(orderHash, { from : sender });
    
                        expect(await this.dex.orderIsCanceled(orderHash)).to.equal(true);
                    });
    
                    it('unlocks the escrowed tokens of the creator', async function () {
                        const wantToken = this.token.address;
    
                        const orderHash = web3.utils.soliditySha3(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            creator,
                            nonce,
                            expirationBlock
                        );
        
                        await this.dex.cancelOrder(orderHash, { from : sender });
    
                        const balance = await this.dex.userBalanceForToken(haveToken, { from : sender });
    
                        expect(balance.locked).to.be.bignumber.equal('0');
                        expect(balance.available).to.be.bignumber.equal(haveAmount);
                    });
    
                    it('emits an OrderCanceled event', async function () {
                        const wantToken = this.token.address;
    
                        const orderHash = web3.utils.soliditySha3(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            creator,
                            nonce,
                            expirationBlock
                        );
        
                        const receipt = await this.dex.cancelOrder(orderHash, { from : sender });
    
                        expectEvent(receipt, 'OrderCanceled', { orderHash : orderHash });
                    });
    
                });
    
                context('the order has already been canceled', function () {
                    it('reverts', async function () {
                        const wantToken = this.token.address;
    
                        const orderHash = web3.utils.soliditySha3(
                            haveToken,
                            haveAmount,
                            wantToken,
                            wantAmount,
                            creator,
                            nonce,
                            expirationBlock
                        );
        
                        await this.dex.cancelOrder(orderHash, { from : sender });
    
                        expect(await this.dex.orderExists(orderHash)).to.equal(true);
                        expect(await this.dex.orderIsCanceled(orderHash)).to.equal(true);
    
                        await expectRevert(
                            this.dex.cancelOrder(orderHash, { from : sender }),
                            'Order has already been canceled'
                        );
                    });
                });
            });

        });
    });

    describe('fill order', function () {
        const sender = user2;
        const haveToken = ZERO_ADDRESS;
        const haveAmount = new BN('10');
        let wantToken;
        const wantAmount = new BN('5');
        const nonce = new BN('1');
        const creator = user;
        let expirationBlock;
        let orderHash;
        const fillAmount = new BN('2');

        beforeEach(async function () {
            wantToken = this.token.address;

            // add token to valud token list
            await this.dex.addToken(this.token.address, { from: owner });

            expect(await this.dex.isValidToken(this.token.address)).to.equal(true);

            const block = await time.latestBlock();
            expirationBlock = new BN(block).add(blockExpiration);

            orderHash = web3.utils.soliditySha3(
                haveToken,
                haveAmount,
                wantToken,
                wantAmount,
                sender,
                nonce,
                expirationBlock
            );
        });

        context('order fill is higher than 0', function () {
            const fillAmount = new BN('2');

            context('order does not exist', function () {
                it('reverts', async function () {
                    await expectRevert(
                        this.dex.fillOrder(orderHash, fillAmount, { from : sender }),
                        'Order does not exist'
                    );
                });
            });
    
            context('order exists', function () {
                beforeEach(async function () {
                    // create order
                    wantToken = this.token.address;

                    await this.dex.createOrder(
                        haveToken,
                        haveAmount,
                        wantToken,
                        wantAmount,
                        { from : creator, value : haveAmount } 
                    );

                    const block = await time.latestBlock();
                    expirationBlock = new BN(block).add(blockExpiration);

                    orderHash = web3.utils.soliditySha3(
                        haveToken,
                        haveAmount,
                        wantToken,
                        wantAmount,
                        creator,
                        nonce,
                        expirationBlock
                    );

                    expect(await this.dex.orderExists(orderHash)).to.equal(true);
                });

                context('order is canceled', function () {
                    beforeEach(async function () {
                        await this.dex.cancelOrder(orderHash, { from : creator });

                        expect(await this.dex.orderIsCanceled(orderHash)).to.equal(true);
                    });

                    it('reverts', async function () {
                        await expectRevert(
                            this.dex.fillOrder(orderHash, fillAmount, { from : sender }),
                            'Order is canceled'
                        );
                    });
                });
    
                context('order is not canceled', function () {
                    context('order is expired', function () {
                        beforeEach(async function () {
                            await time.advanceBlockTo(expirationBlock.add(new BN('1')));
                            expect(await this.dex.orderIsExpired(orderHash)).to.equal(true);
                        });

                        it('reverts', async function () {
                            await expectRevert(
                                this.dex.fillOrder(orderHash, fillAmount, { from : sender }),
                                'Order has expired'
                            );
                        });
                    });
    
                    context('order is not expired', function () {
                        beforeEach(async function () {
                            await this.token.approve(this.dex.address, wantAmount, { from : sender });
                        });

                        context('order has already been completely filled', function () {
                            beforeEach(async function () {
                                const fillAmount = wantAmount;
                                await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                expect(await this.dex.orderIsFilled(orderHash)).to.equal(true);
                            });

                            it('reverts', async function () {
                                await expectRevert(
                                    this.dex.fillOrder(orderHash, fillAmount, { from : sender }),
                                    'Order has already been completely filled'
                                );
                            });
                        });
    
                        context('order cannot be filled for amount', function () {
                            const fillAmount = wantAmount.add(new BN('1'));

                            it('reverts', async function () {
                                await expectRevert(
                                    this.dex.fillOrder(orderHash, fillAmount, { from : sender }),
                                    'Order cannot be filled for that amount'
                                );
                            });
                        });

                        context('order can be filled for amount', function () {
                            context('want token is not ETH and user sends ETH', function () {
                                it('reverts', async function () {
                                    await expectRevert(
                                        this.dex.fillOrder(orderHash, fillAmount, { from : sender, value: new BN('1') }),
                                        'contract does not take ETH'
                                    );
                                });
                            });
        
                            context('user does not have enough escrowed balance', function () {
                                context('user does not have enough token balance', function () {
                                    beforeEach(async function () {
                                        const balance = await this.token.balanceOf(sender);
                                        const transferAmount = balance.sub(fillAmount.sub(new BN('1')));
    
                                        await this.token.transfer(user, transferAmount, { from : sender });
                                    });
    
                                    it('reverts', async function () {
                                        await expectRevert(
                                            this.dex.fillOrder(orderHash, fillAmount, { from : sender }),
                                            'ERC20: transfer amount exceeds balance'
                                        );
                                    });
                                });

                                context('user has enough token balance', function () {
                                    it('updates the order filled amount', async function () {
                                        const prevFill = await this.dex.getOrderFill(orderHash);
    
                                        await this.dex.fillOrder(orderHash, fillAmount, { from : sender });
    
                                        expect(await this.dex.getOrderFill(orderHash)).to.be.bignumber.equal(prevFill.add(fillAmount));
                                    });

                                    it('updates the locked balance of the order creator', async function () {
                                        const orderInfo = await this.dex.getOrderInfo(orderHash);

                                        const balanceBefore = await this.dex.userBalanceForToken(orderInfo.haveToken, { from : orderInfo.creator });

                                        await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                        const balanceAfter = await this.dex.userBalanceForToken(orderInfo.haveToken, { from : orderInfo.creator });

                                        const haveAmount = new BN(orderInfo.haveAmount);
                                        const wantAmount = new BN(orderInfo.wantAmount);

                                        const amountToReceive = ((haveAmount).mul(fillAmount)).div(wantAmount);
                                        const lockedBefore =  new BN(balanceBefore.locked);
                                        const lockedAfter =  new BN(balanceAfter.locked);

                                        expect(lockedAfter).to.be.bignumber.equal((lockedBefore).sub(amountToReceive));
                                    });

                                    it('updates the available balance for both users', async function () {
                                        const orderInfo = await this.dex.getOrderInfo(orderHash);

                                        const balanceBeforeCreator = await this.dex.userBalanceForToken(orderInfo.wantToken, { from : orderInfo.creator });
                                        const balanceBeforeFiller = await this.dex.userBalanceForToken(orderInfo.haveToken, { from : sender });

                                        expect(balanceBeforeFiller.available).to.be.bignumber.equal('0');

                                        await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                        const balanceAfterCreator = await this.dex.userBalanceForToken(orderInfo.wantToken, { from : orderInfo.creator });
                                        const balanceAfterFiller = await this.dex.userBalanceForToken(orderInfo.haveToken, { from : sender });

                                        const haveAmount = new BN(orderInfo.haveAmount);
                                        const wantAmount = new BN(orderInfo.wantAmount);

                                        const amountToReceive = ((haveAmount).mul(fillAmount)).div(wantAmount);

                                        const availableBeforeCreator = new BN(balanceBeforeCreator.available); 
                                        const availableAfterCreator = new BN(balanceAfterCreator.available); 
                                        const availableAfterFiller = new BN(balanceAfterFiller.available);

                                        expect(availableAfterCreator).to.be.bignumber.equal(availableBeforeCreator.add(fillAmount));
                                        expect(availableAfterFiller).to.be.bignumber.equal(amountToReceive);
                                    });

                                    it('emits an OrderFilled event', async function () {
                                        const receipt = await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                        expectEvent(
                                            receipt,
                                            'OrderFilled',
                                            { orderHash : orderHash, amount : fillAmount }
                                        );
                                    });
                                });
                            });

                            context('user has enough escrowed balance', function () {
                                beforeEach(async function () {
                                    await this.dex.depositToken(this.token.address, fillAmount, { from : sender });

                                    const balance = await this.dex.userBalanceForToken(this.token.address, { from : sender });

                                    expect(balance.available).to.be.bignumber.equal(fillAmount);
                                });

                                it('updates the order filled amount', async function () {
                                    const prevFill = await this.dex.getOrderFill(orderHash);

                                    await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                    expect(await this.dex.getOrderFill(orderHash)).to.be.bignumber.equal(prevFill.add(fillAmount));
                                });

                                it('updates the order creator balance', async function () {
                                    const orderInfo = await this.dex.getOrderInfo(orderHash);

                                    await verifyExpectedBalance(this.dex, orderInfo.haveToken, orderInfo.creator, orderInfo.haveAmount, new BN('0'));
                                    await verifyExpectedBalance(this.dex, orderInfo.wantToken, orderInfo.creator, new BN('0'), new BN('0'));

                                    await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                    const amountToGive = ((haveAmount).mul(fillAmount)).div(wantAmount);

                                    const expectedHaveLockedBalanceAfter = (new BN(orderInfo.haveAmount)).sub(amountToGive);

                                    await verifyExpectedBalance(this.dex, orderInfo.haveToken, orderInfo.creator, expectedHaveLockedBalanceAfter, new BN('0'));
                                    await verifyExpectedBalance(this.dex, orderInfo.wantToken, orderInfo.creator, new BN('0'), fillAmount);
                                });

                                it('updates the order filler balance', async function () {
                                    const orderInfo = await this.dex.getOrderInfo(orderHash);

                                    await verifyExpectedBalance(this.dex, orderInfo.haveToken, sender, new BN('0'), new BN('0'));
                                    await verifyExpectedBalance(this.dex, orderInfo.wantToken, sender, new BN('0'), fillAmount);

                                    await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                    const amountToGet = ((haveAmount).mul(fillAmount)).div(wantAmount);

                                    await verifyExpectedBalance(this.dex, orderInfo.haveToken, sender, new BN('0'), amountToGet);
                                    await verifyExpectedBalance(this.dex, orderInfo.wantToken, sender, new BN('0'), new BN('0'));
                                });

                                it('emits an OrderFilled event', async function () {
                                    const receipt = await this.dex.fillOrder(orderHash, fillAmount, { from : sender });

                                    expectEvent(
                                        receipt,
                                        'OrderFilled',
                                        { orderHash : orderHash, amount : fillAmount }
                                    );
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});