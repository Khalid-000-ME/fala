// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FalaVault
/// @notice Onchain spending-policy vault for AI agents. Policy violations on `spend` do NOT revert:
///         they emit `SpendBlocked` (a permanent public attack log) and move no funds.
/// @dev Uses only the USDC ERC-20 interface (6 decimals). No native value is ever accepted.
contract FalaVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Reason {
        NONE,
        PAUSED,
        UNKNOWN_AGENT,
        AGENT_FROZEN,
        POLICY_EXPIRED,
        ZERO_AMOUNT,
        NOTE_TOO_LONG,
        PAYEE_NOT_ALLOWED,
        OVER_PER_TX_CAP,
        OVER_DAILY_TX_COUNT,
        OVER_DAILY_CAP,
        INSUFFICIENT_VAULT_FUNDS,
        TRANSFER_FAILED,
        PENDING_EXPIRED
    }

    enum PendingStatus {
        NONE,
        PENDING,
        EXECUTED,
        REJECTED,
        FAILED
    }

    struct Policy {
        uint64 perTxCap;
        uint64 dailyCap;
        uint64 coSignThreshold;
        uint40 expiry;
        uint16 maxTxPerDay;
        bool active;
        address auditor;
    }

    struct DayState {
        uint32 day;
        uint64 spentToday;
        uint16 txToday;
    }

    struct Pending {
        address agent;
        address payee;
        uint64 amount;
        uint40 createdAt;
        PendingStatus status;
        string note;
    }

    uint256 public constant MAX_NOTE_LENGTH = 140;

    IERC20 public immutable usdc;
    bool public paused;
    uint40 public pendingTtl = 1 hours;
    uint256 public nextPendingId = 1;
    uint256 public totalBlocked;
    uint256 public totalExecuted;

    mapping(address => Policy) public policies;
    mapping(address => bool) public isAgent;
    mapping(address => DayState) public dayState;
    mapping(address => mapping(address => bool)) public payeeAllowed;
    mapping(uint256 => Pending) public pendings;
    mapping(address => uint256) public blockedCount;
    address[] public agentList;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AgentConfigured(address indexed agent, Policy policy);
    event PayeeSet(address indexed agent, address indexed payee, bool allowed);
    event AgentFrozen(address indexed agent, bool frozen);
    event PausedSet(bool paused);
    event PendingTtlSet(uint40 ttl);

    event SpendExecuted(
        address indexed agent, address indexed payee, uint256 amount, uint256 indexed pendingId, string note
    );
    event SpendBlocked(address indexed agent, address indexed payee, uint256 amount, Reason reason, string note);
    event SpendQueued(
        uint256 indexed pendingId, address indexed agent, address indexed payee, uint256 amount, string note
    );
    event SpendApproved(uint256 indexed pendingId, address indexed approver);
    event SpendRejected(uint256 indexed pendingId, address indexed by, Reason reason);

    error InvalidPolicy();
    error InvalidAgent();
    error NotApprover();
    error NotPending();
    error UnknownAgent();

    constructor(address usdc_, address owner_) Ownable(owner_) {
        usdc = IERC20(usdc_);
    }

    // ------------------------------------------------------------------ owner: funds

    function deposit(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // ------------------------------------------------------------------ owner: config

    function configureAgent(address agent, Policy calldata p) external onlyOwner {
        if (agent == address(0)) revert InvalidAgent();
        if (p.coSignThreshold > p.perTxCap) revert InvalidPolicy();
        if (p.auditor == agent) revert InvalidPolicy();
        if (!isAgent[agent]) {
            isAgent[agent] = true;
            agentList.push(agent);
        }
        policies[agent] = p;
        emit AgentConfigured(agent, p);
    }

    function setPayee(address agent, address payee, bool allowed) external onlyOwner {
        _setPayee(agent, payee, allowed);
    }

    function setPayees(address agent, address[] calldata payees, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < payees.length; i++) {
            _setPayee(agent, payees[i], allowed);
        }
    }

    function freezeAgent(address agent, bool frozen) external onlyOwner {
        if (!isAgent[agent]) revert UnknownAgent();
        policies[agent].active = !frozen;
        emit AgentFrozen(agent, frozen);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setPendingTtl(uint40 ttl) external onlyOwner {
        pendingTtl = ttl;
        emit PendingTtlSet(ttl);
    }

    // ------------------------------------------------------------------ agent

    /// @return outcome 0 = EXECUTED, 1 = BLOCKED, 2 = QUEUED
    function spend(address payee, uint256 amount, string calldata note)
        external
        nonReentrant
        returns (uint8 outcome, uint256 pendingId)
    {
        address agent = msg.sender;
        if (isAgent[agent]) _rollDay(agent);

        Reason r = _check(agent, payee, amount, bytes(note).length, true);
        if (r != Reason.NONE) {
            _block(agent, payee, amount, r, note);
            return (1, 0);
        }

        Policy storage p = policies[agent];
        dayState[agent].txToday++;

        if (amount > p.coSignThreshold) {
            pendingId = nextPendingId++;
            pendings[pendingId] = Pending({
                agent: agent,
                payee: payee,
                amount: uint64(amount),
                createdAt: uint40(block.timestamp),
                status: PendingStatus.PENDING,
                note: note
            });
            emit SpendQueued(pendingId, agent, payee, amount, note);
            return (2, pendingId);
        }

        if (!_safeTransferNoRevert(payee, amount)) {
            _block(agent, payee, amount, Reason.TRANSFER_FAILED, note);
            return (1, 0);
        }
        dayState[agent].spentToday += uint64(amount);
        totalExecuted++;
        emit SpendExecuted(agent, payee, amount, 0, note);
        return (0, 0);
    }

    // ------------------------------------------------------------------ auditor / owner

    function approve(uint256 id) external nonReentrant {
        Pending storage p = pendings[id];
        _requireApprover(p);

        if (block.timestamp > uint256(p.createdAt) + pendingTtl) {
            p.status = PendingStatus.REJECTED;
            emit SpendRejected(id, msg.sender, Reason.PENDING_EXPIRED);
            return;
        }

        _rollDay(p.agent);
        Reason r = _check(p.agent, p.payee, p.amount, 0, false);
        if (r != Reason.NONE) {
            _failPending(id, p, r);
            return;
        }
        if (!_safeTransferNoRevert(p.payee, p.amount)) {
            _failPending(id, p, Reason.TRANSFER_FAILED);
            return;
        }

        p.status = PendingStatus.EXECUTED;
        dayState[p.agent].spentToday += p.amount;
        totalExecuted++;
        emit SpendApproved(id, msg.sender);
        emit SpendExecuted(p.agent, p.payee, p.amount, id, p.note);
    }

    function reject(uint256 id) external {
        Pending storage p = pendings[id];
        _requireApprover(p);
        p.status = PendingStatus.REJECTED;
        emit SpendRejected(id, msg.sender, Reason.NONE);
    }

    // ------------------------------------------------------------------ views

    function remainingToday(address agent) external view returns (uint256 amountLeft, uint256 txLeft) {
        Policy storage p = policies[agent];
        (uint256 spent, uint256 txs) = _effectiveDay(agent);
        amountLeft = spent >= p.dailyCap ? 0 : p.dailyCap - spent;
        txLeft = txs >= p.maxTxPerDay ? 0 : p.maxTxPerDay - txs;
    }

    function getAgents() external view returns (address[] memory) {
        return agentList;
    }

    function getPolicy(address agent) external view returns (Policy memory) {
        return policies[agent];
    }

    function vaultBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice Dry-run of `spend` for `agent`; identical ordering and reason codes.
    function check(address agent, address payee, uint256 amount, string calldata note)
        external
        view
        returns (Reason)
    {
        return _check(agent, payee, amount, bytes(note).length, true);
    }

    // ------------------------------------------------------------------ internals

    function _setPayee(address agent, address payee, bool allowed) internal {
        payeeAllowed[agent][payee] = allowed;
        emit PayeeSet(agent, payee, allowed);
    }

    function _requireApprover(Pending storage p) internal view {
        if (p.status != PendingStatus.PENDING) revert NotPending();
        if (msg.sender != owner() && msg.sender != policies[p.agent].auditor) revert NotApprover();
    }

    function _failPending(uint256 id, Pending storage p, Reason r) internal {
        p.status = PendingStatus.FAILED;
        blockedCount[p.agent]++;
        totalBlocked++;
        emit SpendBlocked(p.agent, p.payee, p.amount, r, p.note);
        emit SpendRejected(id, msg.sender, r);
    }

    function _block(address agent, address payee, uint256 amount, Reason r, string memory note) internal {
        blockedCount[agent]++;
        totalBlocked++;
        emit SpendBlocked(agent, payee, amount, r, note);
    }

    function _rollDay(address agent) internal {
        DayState storage d = dayState[agent];
        uint32 today = uint32(block.timestamp / 1 days);
        if (d.day != today) {
            d.day = today;
            d.spentToday = 0;
            d.txToday = 0;
        }
    }

    /// @dev Day counters as they would be after a rollover, without writing.
    function _effectiveDay(address agent) internal view returns (uint256 spent, uint256 txs) {
        DayState storage d = dayState[agent];
        if (d.day == uint32(block.timestamp / 1 days)) return (d.spentToday, d.txToday);
        return (0, 0);
    }

    function _check(address agent, address payee, uint256 amount, uint256 noteLen, bool countTx)
        internal
        view
        returns (Reason)
    {
        if (paused) return Reason.PAUSED;
        if (!isAgent[agent]) return Reason.UNKNOWN_AGENT;
        Policy storage p = policies[agent];
        if (!p.active) return Reason.AGENT_FROZEN;
        if (p.expiry != 0 && block.timestamp > p.expiry) return Reason.POLICY_EXPIRED;
        if (amount == 0) return Reason.ZERO_AMOUNT;
        if (noteLen > MAX_NOTE_LENGTH) return Reason.NOTE_TOO_LONG;
        if (payee == address(0) || !payeeAllowed[agent][payee]) return Reason.PAYEE_NOT_ALLOWED;
        if (amount > p.perTxCap) return Reason.OVER_PER_TX_CAP;
        (uint256 spent, uint256 txs) = _effectiveDay(agent);
        if (countTx && txs >= p.maxTxPerDay) return Reason.OVER_DAILY_TX_COUNT;
        if (spent + amount > p.dailyCap) return Reason.OVER_DAILY_CAP;
        if (usdc.balanceOf(address(this)) < amount) return Reason.INSUFFICIENT_VAULT_FUNDS;
        return Reason.NONE;
    }

    function _safeTransferNoRevert(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
    }
}
