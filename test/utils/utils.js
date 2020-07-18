
const { expect } = require('chai');

async function verifyExpectedBalance(dex, token, user, expectedLocked, expectedAvailable) {
    const balance = await dex.userBalanceForToken(token, { from : user });

    expect(balance.locked).to.be.bignumber.equal(expectedLocked);
    expect(balance.available).to.be.bignumber.equal(expectedAvailable);
}

module.exports = {
    verifyExpectedBalance,
};