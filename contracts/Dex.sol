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

    struct OrderInfo {
        bool canceled;
        address haveToken;
        uint256 haveAmount;
        address wantToken;
        uint256 wantAmount;
        address creator;
        uint256 nonce;
        uint256 expirationBlock;
        uint256 filledAmount;
    }

    /**
    * all orders expire after 500 blocks from the moment they were created
    */
    uint256 private constant EXPIRATION_BLOCKS = 500;

    /** 
    * mapping of tokens accepted by the contract
    * address(0) represents ETH and is supported by default.
    */ 
    mapping(address => bool) private _validTokens;

    /**
    * convenience array for valid tokens
    */ 
    address[] private _validTokensArray;

    /**
    * Mapping of tokens to user balances
    */
    mapping(address => mapping(address => Balance)) private _userBalanceForToken;   

    /**
    * mapping of users to their nonces
    */
    mapping(address => uint256) private _userNonce;

    /**
    * mapping of order hashes to order information
    */
    mapping(bytes32 => OrderInfo) private _orders;

    constructor () public {
        // address(0) represents Ether.
        _validTokens[address(0)] = true;
        _validTokensArray.push(address(0));
        
        emit TokenAdded(address(0));
    }

    /**
    * @notice external function that allows a user to deposit ETH into the contract.
    * it emits a `TokenDeposited` event with address(0) representing ETH
    */
    function deposit() external payable {
        Balance storage balance = _userBalanceOf(address(0), msg.sender);
        balance.available = (balance.available).add(msg.value);

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

        Balance storage balance = _userBalanceOf(token, msg.sender);
        balance.available = (balance.available).add(amount);

        emit TokensDeposited(msg.sender, token, amount);
    }

    /**
    * @notice function that allows a user to withdraw ETH from the contract.
    * it emits a `TokenWithdrawed` event with address(0) representing ETH
    * @param amount of ETH to withdraw
    */
    function withdraw(uint256 amount) external {
        Balance storage balance = _userBalanceOf(address(0), msg.sender);
        require(balance.available >= amount, "not enough balance available");
        balance.available = (balance.available).sub(amount);

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
        Balance storage balance = _userBalanceOf(token, msg.sender);
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
    *
    */
    function removeToken(address token) external onlyOwner {
        require(_isValidToken(token), "this token has not been added yet");
        _validTokens[token] = false;
        emit TokenRemoved(token);
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

        // calculate expirationBlock
        uint256 expirationBlock = _calculateExpiration();

        // lock assets
        _lockTokens(msg.sender, haveToken, haveAmount);

        // update nonce
        _userNonce[msg.sender] = nonce;

        // hash order
        bytes32 orderHash = _hashOrder(
            haveToken,
            haveAmount,
            wantToken,
            wantAmount,
            msg.sender,
            nonce,
            expirationBlock
        );

        // record order info
        _orders[orderHash] = OrderInfo({
            canceled : false,
            haveToken : haveToken,
            haveAmount : haveAmount,
            wantToken : wantToken,
            wantAmount : wantAmount,
            creator : msg.sender,
            nonce : nonce,
            expirationBlock : expirationBlock,
            filledAmount : 0
        });

        // emit event
        emit OrderCreated(
            orderHash,
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
    */
    function cancelOrder(bytes32 orderHash) external {
        // check if order exists
        require(_orderExists(orderHash), "Order does not exist");

        // check if order has already been canceled
        require(!_orderIsCanceled(orderHash), "Order has already been canceled");

        // check that msg.sender is the creator of the order
        require(_isOrderCreator(orderHash, msg.sender), "sender is not the order creator");

        // get order info
        OrderInfo storage orderInfo = _getOrderInfo(orderHash);

        // get filled amount
        uint256 orderFill = _getOrderFill(orderHash);

        // calculate amount to unlock
        uint256 amountToUnlock = (orderInfo.haveAmount).sub(orderFill);

        // unlock tokens
        _unlockTokens(msg.sender, orderInfo.haveToken, amountToUnlock);

        // cancel the order
        _orders[orderHash].canceled = true;

        // emit event
        emit OrderCanceled(orderHash);
    }

    /**
    */
    function fillOrder(bytes32 orderHash, uint256 amountToFill) external payable {
        // check if order exists
        require(_orderExists(orderHash), "Order does not exist");

        // check if order has already been canceled
        require(!_orderIsCanceled(orderHash), "Order is canceled");

        // check if order has expired
        require(!_orderIsExpired(orderHash), "Order has expired");

        // get order info
        OrderInfo storage orderInfo = _getOrderInfo(orderHash);

        // order filled amount
        uint256 filledAmount = orderInfo.filledAmount;

        // check if order has already been completely filled
        require(filledAmount < orderInfo.wantAmount, "Order has already been completely filled");

        // check if order can be filled for that amount
        uint256 fillableAmount = (orderInfo.wantAmount).sub(filledAmount);
        require(amountToFill <= fillableAmount, "Order cannot be filled for that amount");

        // do not send ETH if wantToken is not ETH
        if (!_isEther(orderInfo.wantToken)) {
            require(msg.value == 0, "contract does not take ETH");
        }

        // get sender escrowed balance
        Balance storage fillerBalance = _userBalanceOf(orderInfo.wantToken, msg.sender);

        // If sender does not have enough escrowed balance
        if (fillerBalance.available < amountToFill) {
            // check if we can get balance from somewhere else
            require(
                _checkBank(orderInfo.wantToken, amountToFill.sub(fillerBalance.available)),
                "insufficient balance"
            );
        }

        // calculate amount to trade
        uint256 amountTake = (orderInfo.haveAmount).mul(amountToFill) / orderInfo.wantAmount;
        
        // exchange tokens
        _trade(
            orderInfo.creator, 
            orderInfo.haveToken,
            amountTake,
            msg.sender,
            orderInfo.wantToken,
            amountToFill
        );

        // update order fill amount
        orderInfo.filledAmount = (orderInfo.filledAmount).add(amountToFill);

        // emit event
        emit OrderFilled(
            orderHash,
            msg.sender,
            amountToFill
        );
    }

    /**
    */
    // solhint-disable-next-line cmf-rules-stable/unammed-returns
    function userBalanceForToken(address token) external view returns (Balance memory) {
        return _userBalanceOf(token, msg.sender);
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
    function orderExists(bytes32 orderHash) external view returns (bool) {
        return _orderExists(orderHash);
    }

    /**
    */
    function orderIsCanceled(bytes32 orderHash) external view returns (bool) {
        return _orderIsCanceled(orderHash);
    }

    /**
    */
    function orderIsFilled(bytes32 orderHash) external view returns (bool) {
        return _orderIsFilled(orderHash);
    }

    /**
    */
    function orderIsExpired(bytes32 orderHash) external view returns (bool) {
        return _orderIsExpired(orderHash);
    }

    /**
    */
    function getOrderFill(bytes32 orderHash) external view returns (uint256) {
        return _getOrderFill(orderHash);
    }

    /**
    */
    function getOrderInfo(bytes32 orderHash) external view returns (OrderInfo memory) {
        return _getOrderInfo(orderHash);
    }

    /**
    */
    function _getOrderInfo(bytes32 orderHash) internal view returns (OrderInfo storage) {
        return _orders[orderHash];
    }

    // solhint-disable-next-line cmf-rules-stable/unammed-returns
    function _userBalanceOf(
        address token, 
        address user
    ) internal view returns (Balance storage) {
        return _userBalanceForToken[token][user];
    }

    /**
    */
    function _orderExists(bytes32 orderHash) internal view returns (bool) {
        return _orders[orderHash].nonce > 0;
    }

    /**
    */
    function _orderIsCanceled(bytes32 orderHash) internal view returns (bool) {
        return _orders[orderHash].canceled;
    }

    /**
    */
    function _orderIsExpired(bytes32 orderHash) internal view returns (bool) {
        OrderInfo storage orderInfo = _getOrderInfo(orderHash);
        return  orderInfo.expirationBlock <= block.number;
    }

    /**
    */
    function _orderIsFilled(bytes32 orderHash) internal view returns (bool) {
        OrderInfo storage orderInfo = _getOrderInfo(orderHash);
        return orderInfo.filledAmount == orderInfo.wantAmount;
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

    function _getOrderFill(bytes32 orderHash) internal view returns (uint256) {
        return _orders[orderHash].filledAmount;
    }

    function _isOrderCreator(bytes32 orderHash, address sender) internal view returns (bool) {
        return _orders[orderHash].creator == sender;
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

        emit TokensDeposited(msg.sender, token, amountNeeded);

        return true;
    }

    /**
    */
    function _unlockTokens(
        address user, 
        address token, 
        uint256 amount
    ) internal {
        Balance storage userBalance = _userBalanceOf(token, user);
        userBalance.locked = (userBalance.locked).sub(amount);
        userBalance.available = (userBalance.available).add(amount);
    }

    /**
    */
    function _lockTokens(
        address user, 
        address token, 
        uint256 amount
    ) internal {
        Balance storage userBalance = _userBalanceOf(token, user);
        userBalance.available = (userBalance.available).sub(amount);
        userBalance.locked = (userBalance.locked).add(amount);
    }

    /**
    */
    function _transferEscrowed(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        Balance storage fromBalance = _userBalanceOf(token, from);
        Balance storage toBalance = _userBalanceOf(token, to);

        fromBalance.available = (fromBalance.available).sub(amount);
        toBalance.available = (toBalance.available).add(amount);
    }

    /**
    */
    function _trade(
        address orderCreator,
        address haveToken,
        uint256 haveAmount, 
        address orderTaker,
        address wantToken,
        uint256 wantAmount
    ) internal {
        // unlock order creator tokens
        _unlockTokens(orderCreator, haveToken, haveAmount);

        // transfer tokens
        _transferEscrowed(haveToken, orderCreator, orderTaker, haveAmount);
        _transferEscrowed(wantToken, orderTaker, orderCreator, wantAmount);
    }

    /**
    */
    function _hashOrder(
        address haveToken,
        uint256 haveAmount,
        address wantToken,
        uint256 wantAmount,
        address creator,
        uint256 nonce,
        uint256 expirationBlock
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                haveToken,
                haveAmount,
                wantToken,
                wantAmount,
                creator,
                nonce,
                expirationBlock
            )
        );
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
        bytes32 orderHash,
        address haveToken,
        uint256 haveAmount,
        address wantToken,
        uint256 wantAmount,
        address creator,
        uint256 nonce,
        uint256 expirationBlock
    );

    event OrderCanceled(bytes32 orderHash);

    event OrderFilled(bytes32 orderHash, address filler, uint256 amount);
}