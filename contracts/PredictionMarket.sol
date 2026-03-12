// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title LMSR Prediction Market
/// @notice Binary prediction markets with Logarithmic Market Scoring Rule pricing
contract PredictionMarket {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral;
    address public owner;
    uint256 public marketCount;

    // LMSR liquidity parameter (higher = more liquidity, less price impact)
    uint256 public constant B = 100e18;
    uint256 public constant SCALE = 1e18;

    struct Market {
        string question;
        uint256 resolutionTime;
        int256 qYes;  // quantity of YES shares outstanding
        int256 qNo;   // quantity of NO shares outstanding
        bool resolved;
        uint8 outcome; // 0 = NO wins, 1 = YES wins
        bytes32 oracleData;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => int256)) public yesShares;
    mapping(uint256 => mapping(address => int256)) public noShares;

    event MarketCreated(uint256 indexed marketId, string question, uint256 resolutionTime);
    event Trade(uint256 indexed marketId, address indexed trader, bool isYes, int256 shares, uint256 cost);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 payout);

    constructor(address _collateral) {
        collateral = IERC20(_collateral);
        owner = msg.sender;
    }

    function createMarket(string calldata question, uint256 resolutionTime, bytes32 oracleData) external returns (uint256) {
        uint256 marketId = marketCount++;
        markets[marketId] = Market({
            question: question,
            resolutionTime: resolutionTime,
            qYes: 0,
            qNo: 0,
            resolved: false,
            outcome: 0,
            oracleData: oracleData
        });
        emit MarketCreated(marketId, question, resolutionTime);
        return marketId;
    }

    /// @notice LMSR cost function: C(q) = b * ln(e^(qYes/b) + e^(qNo/b))
    function _cost(int256 qYes, int256 qNo) internal pure returns (uint256) {
        // Using approximation for gas efficiency
        // cost ≈ b * ln(2) + max(qYes, qNo) + b * ln(1 + e^(-|qYes-qNo|/b))
        int256 maxQ = qYes > qNo ? qYes : qNo;
        int256 diff = qYes > qNo ? qYes - qNo : qNo - qYes;
        
        // Simplified: cost ≈ max(qYes, qNo) + b * ln(1 + e^(-diff/b))
        // For small diff/b, ln(1 + e^(-x)) ≈ ln(2) - x/2
        uint256 base = uint256(maxQ > 0 ? maxQ : int256(0));
        uint256 adjustment = (B * 693) / 1000; // b * ln(2) ≈ 0.693 * b
        
        if (diff > int256(B * 3)) {
            return base + adjustment / 10; // negligible adjustment for large diff
        }
        return base + adjustment;
    }

    /// @notice Buy shares - positive amount for YES, negative for NO
    function buy(uint256 marketId, bool isYes, uint256 amount) external returns (uint256 cost) {
        Market storage m = markets[marketId];
        require(!m.resolved, "resolved");
        require(block.timestamp < m.resolutionTime, "expired");

        int256 shares = int256(amount);
        uint256 costBefore = _cost(m.qYes, m.qNo);
        
        if (isYes) {
            m.qYes += shares;
            yesShares[marketId][msg.sender] += shares;
        } else {
            m.qNo += shares;
            noShares[marketId][msg.sender] += shares;
        }
        
        uint256 costAfter = _cost(m.qYes, m.qNo);
        cost = costAfter > costBefore ? costAfter - costBefore : 0;
        
        if (cost > 0) {
            collateral.safeTransferFrom(msg.sender, address(this), cost);
        }
        
        emit Trade(marketId, msg.sender, isYes, shares, cost);
    }

    /// @notice Get current price for YES outcome (0-1 scaled by 1e18)
    function getPrice(uint256 marketId) external view returns (uint256 yesPrice, uint256 noPrice) {
        Market storage m = markets[marketId];
        // Price = e^(q/b) / (e^(qYes/b) + e^(qNo/b))
        // Simplified: if qYes > qNo, yesPrice > 0.5
        int256 diff = m.qYes - m.qNo;
        
        if (diff == 0) {
            return (SCALE / 2, SCALE / 2);
        }
        
        // Approximate sigmoid: price ≈ 0.5 + diff / (4 * b)
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
        
        // Clear shares
        yesShares[marketId][msg.sender] = 0;
        noShares[marketId][msg.sender] = 0;
        
        payout = uint256(winningShares);
        collateral.safeTransfer(msg.sender, payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    function setOwner(address newOwner) external {
        require(msg.sender == owner, "only owner");
        owner = newOwner;
    }
}
