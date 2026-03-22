// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LMSR Prediction Market (native CELO)
contract PredictionMarket {
    address public owner;
    uint256 public marketCount;

    uint256 public constant B = 100e18;
    uint256 public constant SCALE = 1e18;

    struct Market {
        string question;
        uint256 resolutionTime;
        int256 qYes;
        int256 qNo;
        bool resolved;
        uint8 outcome;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => int256)) public yesShares;
    mapping(uint256 => mapping(address => int256)) public noShares;

    event MarketCreated(uint256 indexed marketId, string question, uint256 resolutionTime);
    event Trade(uint256 indexed marketId, address indexed trader, bool isYes, int256 shares, uint256 cost);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 payout);

    constructor() { owner = msg.sender; }

    function createMarket(string calldata question, uint256 resolutionTime) external returns (uint256) {
        require(bytes(question).length > 0, "empty question");
        require(resolutionTime > block.timestamp + 5 minutes, "too soon");
        uint256 marketId = marketCount++;
        markets[marketId] = Market(question, resolutionTime, 0, 0, false, 0);
        emit MarketCreated(marketId, question, resolutionTime);
        return marketId;
    }

    function _cost(int256 qYes, int256 qNo) internal pure returns (uint256) {
        int256 maxQ = qYes > qNo ? qYes : qNo;
        int256 diff = qYes > qNo ? qYes - qNo : qNo - qYes;
        uint256 base = uint256(maxQ > 0 ? maxQ : int256(0));
        uint256 adjustment = (B * 693) / 1000;
        if (diff > int256(B * 3)) return base + adjustment / 10;
        return base + adjustment;
    }

    function buy(uint256 marketId, bool isYes, uint256 amount) external payable returns (uint256 cost) {
        require(amount > 0, "invalid amount");
        Market storage m = markets[marketId];
        require(!m.resolved, "resolved");
        require(block.timestamp < m.resolutionTime, "expired");

        uint256 costBefore = _cost(m.qYes, m.qNo);
        int256 shares = int256(amount);
        if (isYes) { m.qYes += shares; yesShares[marketId][msg.sender] += shares; }
        else        { m.qNo  += shares; noShares[marketId][msg.sender]  += shares; }

        uint256 costAfter = _cost(m.qYes, m.qNo);
        cost = costAfter > costBefore ? costAfter - costBefore : 0;
        require(msg.value >= cost, "insufficient CELO");

        // Refund excess
        if (msg.value > cost) payable(msg.sender).transfer(msg.value - cost);
        emit Trade(marketId, msg.sender, isYes, shares, cost);
    }

    function getPrice(uint256 marketId) external view returns (uint256 yesPrice, uint256 noPrice) {
        Market storage m = markets[marketId];
        int256 diff = m.qYes - m.qNo;
        if (diff == 0) return (SCALE / 2, SCALE / 2);
        int256 adjustment = (diff * int256(SCALE)) / (4 * int256(B));
        int256 yes = int256(SCALE / 2) + adjustment;
        if (yes < 0) yes = 0;
        if (yes > int256(SCALE)) yes = int256(SCALE);
        yesPrice = uint256(yes);
        noPrice = SCALE - yesPrice;
    }

    function resolve(uint256 marketId, uint8 outcome) external {
        require(msg.sender == owner, "only owner");
        Market storage m = markets[marketId];
        require(!m.resolved, "already resolved");
        require(outcome <= 1, "invalid outcome");
        require(block.timestamp >= m.resolutionTime, "too early");
        m.resolved = true;
        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    function claim(uint256 marketId) external returns (uint256 payout) {
        Market storage m = markets[marketId];
        require(m.resolved, "not resolved");
        int256 winningShares = m.outcome == 1
            ? yesShares[marketId][msg.sender]
            : noShares[marketId][msg.sender];
        require(winningShares > 0, "no winning shares");
        yesShares[marketId][msg.sender] = 0;
        noShares[marketId][msg.sender] = 0;
        payout = uint256(winningShares);
        payable(msg.sender).transfer(payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    function setOwner(address newOwner) external {
        require(msg.sender == owner, "only owner");
        owner = newOwner;
    }

    receive() external payable {}
}
