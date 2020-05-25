pragma solidity ^0.5.0;

// solhint-disable-next-line var-name-mixedcase
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract Dex is Ownable {
    using SafeMath for uint256;

    struct Balance {
        uint256 available;
        uint256 locked;
    }

    //
    uint256 private constant EXPIRATION_BLOCKS = 500;

    //
    mapping(address => bool) private _validTokens;

    //
    address[] private _validTokensArray;

    //
    mapping(address => mapping(address => Balance)) private _userBalanceForToken;   

    //
    mapping(address => uint256) private _userNonce;

    //
    mapping(address => mapping(bytes32 => bool)) private _orders;

    //
    mapping(address => mapping (bytes32 => uint256)) private _orderFills;

    constructor () public {
        // address(0) represents Ether.
        _validTokens[address(0)] = true;
        _validTokensArray.push(address(0));
    }

    /**
    * @notice function that allows a user to deposit ETH into the contract.
    * it emits a `TokenDeposited` event with address(0) representing ETH
    */
    function deposit() external payable {
        Balance storage b = _userBalanceForToken[address(0)][msg.sender];
        b.available = (b.available).add(msg.value);

        emit TokensDeposited(msg.sender, address(0), msg.value);
    }

    /**
    * @notice function that allows a user to deposit tokens into the contract.
    * it emits a `TokenDeposited`
    * @param token the address of a ERC20 token.
    * @param amount amount to be deposited
    */
    function depositToken(
        address token, 
        uint256 amount
    ) external onlyTokens(token) onlyValidTokens(token) {
        require(
            IERC20(token).transferFrom(msg.sender, address(this), amount),
            "ERC20: transfer failed"
        );

        Balance storage b = _userBalanceForToken[token][msg.sender];
        b.available = (b.available).add(amount);

        emit TokensDeposited(msg.sender, token, amount);
    }

    /**
    * @notice function that allows a user to withdraw ETH from the contract.
    * it emits a `TokenWithdrawed` event with address(0) representing ETH
    * @param amount of ETH to withdraw
    */
    function withdraw(uint256 amount) external {
        Balance storage b = _userBalanceForToken[address(0)][msg.sender];
        require(b.available >= amount, "not enough balance available");
        b.available = (b.available).sub(amount);

        msg.sender.transfer(amount);

        emit TokensWithdrawed(msg.sender, address(0), amount);        
    }

    /**
    * @notice function that allows a user to withdraw tokens from the contract.
    * it emits a `LogWithdrawToken`
    * @param token the address of a ERC20 token.
    * @param amount amount to withdraw
    */
    function withdrawToken(
        address token, 
        uint256 amount
    ) external onlyTokens(token) onlyValidTokens(token) {
        Balance storage balance = _userBalanceForToken[token][msg.sender];
        require(balance.available >= amount, "not enough balance available");
        balance.available = (balance.available).sub(amount);

        require(
            IERC20(token).transfer(msg.sender, amount), 
            "ERC20: transfer failed"
        );

        emit TokensWithdrawed(msg.sender, token, amount);        
    }

    /**
    *
    */
    function addToken(address token) external onlyOwner {
        require(!_isValidToken(token), "this token has already been added");
        _validTokens[token] = true;
        emit TokenAdded(token);
    }

    /**
    */
    function createOrder(
        address haveToken,
        uint256 haveAmount,
        address wantToken,
        uint256 wantAmount
    ) external payable onlyValidTokens(haveToken) onlyValidTokens(wantToken) {
        if (!_isEther(haveToken)) {
            require(msg.value == 0, "contract does not take ETH");
        }

        Balance storage balance = _userBalanceOf(haveToken, msg.sender);

        // If sender does not have enough escrowed balance
        if (balance.available < haveAmount) {
            // check if we can get balance from somewhere else
            require(
                _checkBank(haveToken, haveAmount.sub(balance.available)),
                "insufficient balance"
            );
        }

        // get nonce
        uint256 nonce = _getNonce(msg.sender).add(1);

        // expirationBlock
        uint256 expirationBlock = _calculateExpiration();

        // lock assets
        balance.available = balance.available.sub(haveAmount);
        balance.locked = balance.locked.add(haveAmount);

        // update nonce
        _userNonce[msg.sender] = nonce;

        // hash order
        bytes32 orderHash = keccak256(
            abi.encodePacked(
                haveToken,
                haveAmount,
                wantToken,
                wantAmount,
                msg.sender,
                nonce,
                expirationBlock
            )
        );

        // update orders
        _orders[msg.sender][orderHash] = true;

        // emit event
        emit OrderCreated(
            haveToken, 
            haveAmount, 
            wantToken, 
            wantAmount, 
            msg.sender, 
            nonce, 
            expirationBlock
        );
    }

    /**
    *
    */
    function removeToken(address token) external onlyOwner {
        require(_isValidToken(token), "this token has not been added yet");
        _validTokens[token] = false;
        emit TokenRemoved(token);
    }

    /**
    */
    // solhint-disable-next-line cmf-rules-stable/unammed-returns
    function userBalanceForToken(address token) external view returns (Balance memory) {
        return _userBalanceOf(token, msg.sender);
    }

    // solhint-disable-next-line cmf-rules-stable/unammed-returns
    function _userBalanceOf(address token, address user) internal view returns (Balance storage) {
        return _userBalanceForToken[token][user];
    }

    /**
    */
    function isValidToken(address token) external view returns (bool) {
        return _isValidToken(token);
    }

    /**
    */
    function getValidTokens() external view returns (address[] memory) {
        return _validTokensArray;
    }

    /**
    */
    function orderExists(address creator, bytes32 orderHash) external view returns (bool) {
        return _orders[creator][orderHash];
    }

    /**
    */
    function getOrderFill(address creator, bytes32 orderHash) external view returns (uint256) {
        return _orderFills[creator][orderHash];
    }

    /**
    */
    function _isEther(address token) internal pure returns (bool) {
        return token == address(0);
    }

    /**
    */
    function _isValidToken(address token) internal view returns (bool) {
        return _validTokens[token];
    }

    function _getNonce(address user) internal view returns (uint256) {
        return _userNonce[user];
    }

    function _calculateExpiration() internal view returns (uint256) {
        return block.number.add(EXPIRATION_BLOCKS);
    }

    /**
    */
    function _checkBank(
        address token, 
        uint256 amountNeeded
    ) internal returns (bool) {
        // if token is ether, check msg.value
        if (_isEther(token)) {
            require(msg.value >= amountNeeded, "Ether: Not enough balance");

            uint256 remaining = (msg.value).sub(amountNeeded);

            if (remaining > 0) {
                // return remaining ether to sender
                (msg.sender).transfer((msg.value).sub(amountNeeded));
            }

        // if token is ERC20, check allowance
        } else {
            require(
                IERC20(token).transferFrom(msg.sender, address(this), amountNeeded),
                "ERC20 transfer failed"
            );
        }
        // update balance
        Balance storage balance = _userBalanceOf(token, msg.sender);
        balance.available = balance.available.add(amountNeeded);

        return true;
    }

    modifier onlyTokens(address token) {
        require(!_isEther(token), "address cannot be the 0 address");
        _;
    }

    modifier onlyValidTokens(address token) {
        require(_isValidToken(token) || _isEther(token), "token is not valid");
        _;
    }

    event TokenAdded(address token);

    event TokenRemoved(address token);
    
    event TokensDeposited(address depositer, address token, uint256 amount);

    event TokensWithdrawed(address withdrawer, address token, uint256 amount);

    event OrderCreated(
        address haveToken,
        uint256 haveAmount,
        address wantToken,
        uint256 wantAmount,
        address sender,
        uint256 nonce,
        uint256 expirationBlock
    );
}