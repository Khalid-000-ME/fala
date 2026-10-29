// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DkimVerifier} from "./DkimVerifier.sol";

error UnknownKey();
error KeyRevoked();
error KeyNotActive();
error BadSignature();
error FromNotApprover();
error DomainMismatch();
error SubjectMalformed();
error IntentNotPending();
error IntentExpired();
error CodeMismatch();
error StaleTimestamp();
error Frozen();
error UseDeposit();

/// @title FalaVault
/// @notice An AI agent spends small amounts from this vault on its own. Anything bigger becomes an intent that the human
///         approves, denies or freezes by replying to an email: the contract verifies Gmail's DKIM signature on the reply.
/// @dev Amounts are 6-decimal USDC via the ERC-20 interface. Deposits are payable (native USDC has 18 decimals).
contract FalaVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        NONE,
        PENDING,
        APPROVED,
        DENIED,
        EXPIRED,
        CANCELLED,
        FAILED,
        AUTO_PAID
    }

    uint8 public constant VERB_APPROVE = 1;
    uint8 public constant VERB_DENY = 2;
    uint8 public constant VERB_FREEZE = 3;

    uint8 public constant REJ_NOT_AGENT = 1;
    uint8 public constant REJ_FROZEN = 2;
    uint8 public constant REJ_BAD_INPUT = 3;
    uint8 public constant REJ_OVER_HARD_CAP = 4;
    uint8 public constant REJ_PAYOUT_FAILED = 5;

    /// @dev Clock slack between the DKIM `t=` and `block.timestamp`/`createdAt`, in seconds.
    uint256 public constant CLOCK_SLACK = 5 minutes;
    /// @dev A FREEZE email older than this is refused: a withheld freeze cannot be replayed months later.
    uint256 public constant FREEZE_MAX_AGE = 1 days;

    struct AgentCfg {
        bool active;
        uint64 autoPerTx;
        uint64 autoDaily;
        uint64 hardCap;
        uint32 day;
        uint64 autoSpentToday;
    }

    struct Intent {
        address agent;
        address payee;
        uint64 amount;
        uint40 createdAt;
        uint40 expiresAt;
        Status status;
        bytes4 code;
        string memo;
    }

    struct DkimKey {
        bytes n;
        bytes e;
        uint40 activeAt;
        bool revoked;
    }

    IERC20 public immutable usdc;
    bytes32 public approverHash;
    bytes32 public approverDomainHash;
    bool public frozen;
    uint40 public intentTtl = 1 hours;
    uint40 public keyTimelock = 1 days;
    uint64 public relayerTip = 20_000;
    uint64 public lastFreezeT;
    uint256 public nextIntentId = 1;

    mapping(address => AgentCfg) public agents;
    address[] public agentList;
    mapping(address => bool) public knownPayee;
    mapping(uint256 => Intent) public intents;
    mapping(bytes32 => DkimKey) public keys;
    bytes32[] public keyIds;
    mapping(bytes32 => uint256) public domainKeyCount;
    mapping(bytes32 => bytes32) public keyDomain; // keyId => keccak256(lowercase d=)

    event Deposited(address indexed from, uint256 amount6);
    event Withdrawn(address indexed to, uint256 amount6);
    event AgentSet(address indexed agent, AgentCfg cfg);
    event PayeeSet(address indexed payee, bool known);
    event ApproverSet(bytes32 approverHash, bytes32 domainHash);
    event KeyProposed(bytes32 indexed keyId, string domain, string selector, uint40 activeAt);
    event KeyRevokedByOwner(bytes32 indexed keyId);

    event AutoPaid(address indexed agent, address indexed payee, uint256 amount6, string memo);
    event IntentCreated(
        uint256 indexed id,
        address indexed agent,
        address indexed payee,
        uint256 amount6,
        bytes4 code,
        uint40 expiresAt,
        string memo
    );
    event IntentRejected(address indexed agent, address indexed payee, uint256 amount6, uint8 reason);
    event EmailApproved(uint256 indexed id, bytes32 indexed keyId, uint64 dkimT, address relayer);
    event EmailDenied(uint256 indexed id, bytes32 indexed keyId, uint64 dkimT);
    event EmailFrozen(bytes32 indexed keyId, uint64 dkimT);
    event Paid(uint256 indexed id, address indexed payee, uint256 amount6);
    event PayoutFailed(uint256 indexed id, address indexed payee, uint256 amount6);
    event IntentClosed(uint256 indexed id, Status status);
    event Unfrozen(address by);

    error InvalidConfig();
    error NotAllowed();
    error NotPending();
    error NotExpired();
    error KeyExists();
    error RenounceDisabled();

    constructor(
        address usdc_,
        address owner_,
        string memory approverEmail,
        string memory domain,
        string memory selector,
        bytes memory n,
        bytes memory e
    ) Ownable(owner_) {
        if (usdc_.code.length == 0) revert InvalidConfig(); // a call to a code-less address would "succeed" silently
        usdc = IERC20(usdc_);
        _addKey(domain, selector, n, e, uint40(block.timestamp));
        _setApprover(approverEmail);
    }

    /// @dev Disabled: renouncing would strand the funds and make `unfreeze` / key revocation impossible forever.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ funds

    /// @notice Native USDC has 18 decimals; the vault accounts in 6. `msg.value` must be a multiple of 1e12.
    function deposit() external payable {
        if (msg.value == 0 || msg.value % 1e12 != 0) revert InvalidConfig();
        emit Deposited(msg.sender, msg.value / 1e12);
    }

    receive() external payable {
        revert UseDeposit();
    }

    /// @notice Owner pulls USDC out. Like every payout it never reverts on a token failure: it emits `PayoutFailed`.
    function withdraw(address to, uint256 amount6) external onlyOwner nonReentrant {
        if (!_payNoRevert(to, amount6)) {
            emit PayoutFailed(0, to, amount6);
            return;
        }
        emit Withdrawn(to, amount6);
    }

    // ------------------------------------------------------------------ owner config

    function setAgent(address agent, uint64 autoPerTx, uint64 autoDaily, uint64 hardCap, bool active)
        external
        onlyOwner
    {
        if (agent == address(0) || agent == owner() || autoPerTx > hardCap) revert InvalidConfig();
        AgentCfg storage a = agents[agent];
        if (a.hardCap == 0 && !a.active && a.autoPerTx == 0) {
            bool known;
            for (uint256 i = 0; i < agentList.length; i++) {
                if (agentList[i] == agent) known = true;
            }
            if (!known) agentList.push(agent);
        }
        a.active = active;
        a.autoPerTx = autoPerTx;
        a.autoDaily = autoDaily;
        a.hardCap = hardCap;
        emit AgentSet(agent, a);
    }

    function setPayee(address payee, bool known) external onlyOwner {
        knownPayee[payee] = known;
        emit PayeeSet(payee, known);
    }

    function setApprover(string calldata email) external onlyOwner {
        _setApprover(email);
    }

    function proposeKey(string calldata domain, string calldata selector, bytes calldata n, bytes calldata e)
        external
        onlyOwner
    {
        _addKey(domain, selector, n, e, uint40(block.timestamp) + keyTimelock);
    }

    function revokeKey(bytes32 keyId) external onlyOwner {
        if (keys[keyId].n.length == 0) revert UnknownKey();
        keys[keyId].revoked = true;
        emit KeyRevokedByOwner(keyId);
    }

    function unfreeze() external onlyOwner {
        frozen = false;
        emit Unfrozen(msg.sender);
    }

    function setParams(uint40 ttl, uint64 tip) external onlyOwner {
        if (ttl == 0 || tip > 50_000) revert InvalidConfig();
        intentTtl = ttl;
        relayerTip = tip;
    }

    // ------------------------------------------------------------------ agent

    /// @notice Agents never get a revert for policy: they get an outcome (and an event).
    function request(address payee, uint64 amount6, string calldata memo)
        external
        nonReentrant
        returns (Status outcome, uint256 id)
    {
        AgentCfg storage a = agents[msg.sender];
        if (!a.active) {
            emit IntentRejected(msg.sender, payee, amount6, REJ_NOT_AGENT);
            return (Status.NONE, 0);
        }
        _rollDay(a);
        if (frozen) {
            emit IntentRejected(msg.sender, payee, amount6, REJ_FROZEN);
            return (Status.NONE, 0);
        }
        if (amount6 == 0 || payee == address(0) || bytes(memo).length > 140) {
            emit IntentRejected(msg.sender, payee, amount6, REJ_BAD_INPUT);
            return (Status.NONE, 0);
        }
        if (amount6 > a.hardCap) {
            emit IntentRejected(msg.sender, payee, amount6, REJ_OVER_HARD_CAP);
            return (Status.NONE, 0);
        }

        if (
            knownPayee[payee] && amount6 <= a.autoPerTx && uint256(a.autoSpentToday) + amount6 <= a.autoDaily
                && vaultBalance() >= amount6
        ) {
            a.autoSpentToday += amount6; // effects before the external call; undone if the transfer fails
            if (!_payNoRevert(payee, amount6)) {
                a.autoSpentToday -= amount6;
                emit PayoutFailed(0, payee, amount6);
                emit IntentRejected(msg.sender, payee, amount6, REJ_PAYOUT_FAILED);
                return (Status.NONE, 0);
            }
            emit AutoPaid(msg.sender, payee, amount6, memo);
            return (Status.AUTO_PAID, 0);
        }

        id = nextIntentId++;
        bytes4 code = _code(id, msg.sender, payee, amount6);
        uint40 exp = uint40(block.timestamp) + intentTtl;
        intents[id] = Intent({
            agent: msg.sender,
            payee: payee,
            amount: amount6,
            createdAt: uint40(block.timestamp),
            expiresAt: exp,
            status: Status.PENDING,
            code: code,
            memo: memo
        });
        emit IntentCreated(id, msg.sender, payee, amount6, code, exp, memo);
        return (Status.PENDING, id);
    }

    function cancel(uint256 id) external {
        Intent storage i = intents[id];
        if (msg.sender != i.agent && msg.sender != owner()) revert NotAllowed();
        if (i.status != Status.PENDING) revert NotPending();
        i.status = Status.CANCELLED;
        emit IntentClosed(id, Status.CANCELLED);
    }

    function expire(uint256 id) external {
        Intent storage i = intents[id];
        if (i.status != Status.PENDING) revert NotPending();
        if (block.timestamp <= i.expiresAt) revert NotExpired();
        i.status = Status.EXPIRED;
        emit IntentClosed(id, Status.EXPIRED);
    }

    // ------------------------------------------------------------------ relayer: the email path

    /// @param headerBlock relaxed-canonicalized signed headers + the DKIM-Signature header (b= emptied, no trailing CRLF)
    /// @param sig decoded `b=` bytes
    function approveByEmail(bytes calldata headerBlock, bytes calldata sig) external nonReentrant {
        (DkimVerifier.DkimResult memory r, bytes32 keyId) = _authenticate(headerBlock, sig);
        (uint8 verb, uint256 id, bytes4 code) = _parseSubject(r.subject);

        if (verb == VERB_FREEZE) {
            if (code != freezeCode()) revert CodeMismatch();
            _checkFreeze(r.t);
            lastFreezeT = r.t;
            frozen = true;
            emit EmailFrozen(keyId, r.t);
            return;
        }

        Intent storage i = intents[id];
        _checkIntent(i, code, r.t);
        if (block.timestamp > i.expiresAt) {
            i.status = Status.EXPIRED;
            emit IntentClosed(id, Status.EXPIRED);
            return;
        }

        if (verb == VERB_DENY) {
            i.status = Status.DENIED;
            emit EmailDenied(id, keyId, r.t);
            return;
        }

        if (frozen) revert Frozen();
        emit EmailApproved(id, keyId, r.t, msg.sender);
        i.status = Status.APPROVED;
        if (!_payNoRevert(i.payee, i.amount)) {
            i.status = Status.FAILED;
            emit PayoutFailed(id, i.payee, i.amount);
            return;
        }
        emit Paid(id, i.payee, i.amount);
        uint64 tip = relayerTip;
        if (tip > 0 && vaultBalance() >= tip && !_payNoRevert(msg.sender, tip)) emit PayoutFailed(id, msg.sender, tip);
    }

    // ------------------------------------------------------------------ views

    /// @notice Dry-run of `approveByEmail`: same checks, same named errors, no state change. One deliberate difference:
    ///         for an otherwise valid reply to an intent that has expired, `approveByEmail` closes the intent as EXPIRED
    ///         and returns without paying, while this view reverts `IntentExpired` so a relayer knows nothing will be paid.
    function checkEmail(bytes calldata headerBlock, bytes calldata sig) external view returns (uint8 verb, uint256 id) {
        (DkimVerifier.DkimResult memory r,) = _authenticate(headerBlock, sig);
        bytes4 code;
        (verb, id, code) = _parseSubject(r.subject);
        if (verb == VERB_FREEZE) {
            if (code != freezeCode()) revert CodeMismatch();
            _checkFreeze(r.t);
            return (verb, id);
        }
        Intent storage i = intents[id];
        _checkIntent(i, code, r.t);
        if (block.timestamp > i.expiresAt) revert IntentExpired();
        if (verb == VERB_APPROVE && frozen) revert Frozen();
    }

    function codeOf(uint256 id) external view returns (bytes4) {
        return intents[id].code;
    }

    /// @notice The code a FREEZE reply must carry. Bound to this vault and chain, so one email cannot freeze other vaults.
    function freezeCode() public view returns (bytes4) {
        return bytes4(keccak256(abi.encode(block.chainid, address(this), "FREEZE")));
    }

    /// @notice The exact subject the human's reply must carry, e.g. "FALA APPROVE 42 7f3a9c1b".
    function subjectFor(uint256 id, uint8 verb) external view returns (string memory) {
        if (verb == VERB_FREEZE) return string.concat("FALA FREEZE 0 ", _hex8(freezeCode()));
        string memory v = verb == VERB_APPROVE ? "APPROVE" : "DENY";
        return string.concat("FALA ", v, " ", _toString(id), " ", _hex8(intents[id].code));
    }

    function getAgents() external view returns (address[] memory) {
        return agentList;
    }

    function getKeyIds() external view returns (bytes32[] memory) {
        return keyIds;
    }

    function vaultBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ------------------------------------------------------------------ internals

    function _authenticate(bytes calldata headerBlock, bytes calldata sig)
        internal
        view
        returns (DkimVerifier.DkimResult memory r, bytes32 keyId)
    {
        bytes memory hb = headerBlock;
        r = DkimVerifier.parse(hb);
        keyId = keccak256(abi.encode(r.domainHash, r.selectorHash));
        DkimKey storage k = keys[keyId];
        if (k.n.length == 0) revert UnknownKey();
        if (k.revoked) revert KeyRevoked();
        if (block.timestamp < k.activeAt) revert KeyNotActive();
        if (!DkimVerifier.verify(hb, sig, k.n, k.e)) revert BadSignature();
        if (r.fromHash != approverHash) revert FromNotApprover();
        if (r.fromDomainHash != r.domainHash || r.domainHash != approverDomainHash) revert DomainMismatch();
    }

    function _checkIntent(Intent storage i, bytes4 code, uint64 t) internal view {
        if (i.status != Status.PENDING) revert IntentNotPending();
        if (code != i.code) revert CodeMismatch();
        // the email must carry a signing time, and it must fall after the intent existed (clock slack) and before it expired
        if (t == 0 || uint256(t) + CLOCK_SLACK < i.createdAt || t > i.expiresAt) revert StaleTimestamp();
    }

    /// @dev FREEZE has no intent to bind to, so it is bound to time: strictly newer than the last accepted freeze,
    ///      not older than FREEZE_MAX_AGE, and not from the future (a far-future `t` would otherwise poison `lastFreezeT`).
    function _checkFreeze(uint64 t) internal view {
        if (t <= lastFreezeT || uint256(t) + FREEZE_MAX_AGE < block.timestamp || t > block.timestamp + CLOCK_SLACK) {
            revert StaleTimestamp();
        }
    }

    function _addKey(string memory domain, string memory selector, bytes memory n, bytes memory e, uint40 activeAt)
        internal
    {
        if (n.length < 256 || e.length == 0) revert InvalidConfig();
        bytes32 d = keccak256(DkimVerifier._lower(bytes(domain)));
        bytes32 id = keccak256(abi.encode(d, keccak256(DkimVerifier._lower(bytes(selector)))));
        if (keys[id].n.length != 0) revert KeyExists();
        keys[id] = DkimKey({n: n, e: e, activeAt: activeAt, revoked: false});
        keyDomain[id] = d;
        keyIds.push(id);
        domainKeyCount[d]++;
        emit KeyProposed(id, domain, selector, activeAt);
    }

    function _setApprover(string memory email) internal {
        bytes memory b = DkimVerifier._lower(bytes(email));
        uint256 at = type(uint256).max;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == "@") {
                if (at != type(uint256).max) revert InvalidConfig();
                at = i;
            }
        }
        if (at == type(uint256).max || at == 0 || at + 1 == b.length) revert InvalidConfig();
        bytes memory dom = new bytes(b.length - at - 1);
        for (uint256 i = 0; i < dom.length; i++) {
            dom[i] = b[at + 1 + i];
        }
        bytes32 dh = keccak256(dom);
        if (!_hasActiveKey(dh)) revert InvalidConfig();
        approverHash = keccak256(b);
        approverDomainHash = dh;
        emit ApproverSet(approverHash, dh);
    }

    /// @dev The approver's domain must have a key that can verify emails right now (registered, active, not revoked).
    function _hasActiveKey(bytes32 domainHash) internal view returns (bool) {
        for (uint256 i = 0; i < keyIds.length; i++) {
            bytes32 id = keyIds[i];
            DkimKey storage k = keys[id];
            if (keyDomain[id] == domainHash && !k.revoked && block.timestamp >= k.activeAt) return true;
        }
        return false;
    }

    function _rollDay(AgentCfg storage a) internal {
        uint32 today = uint32(block.timestamp / 1 days);
        if (a.day != today) {
            a.day = today;
            a.autoSpentToday = 0;
        }
    }

    function _code(uint256 id, address agent, address payee, uint256 amount) internal view returns (bytes4) {
        return bytes4(keccak256(abi.encode(block.chainid, address(this), id, agent, payee, amount)));
    }

    function _payNoRevert(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
    }

    /// @dev Strict grammar: `[re: ]FALA <APPROVE|DENY|FREEZE> <id> <code>`; code = 8 lowercase hex (FREEZE: id is `0`).
    function _parseSubject(bytes memory s) internal pure returns (uint8 verb, uint256 id, bytes4 code) {
        uint256 p = 0;
        uint256 end = s.length;
        while (p < end && s[p] == " ") p++;
        while (end > p && s[end - 1] == " ") end--;
        if (end - p >= 4 && _lc(s[p]) == "r" && _lc(s[p + 1]) == "e" && s[p + 2] == ":" && s[p + 3] == " ") {
            p += 4;
            while (p < end && s[p] == " ") p++;
        }
        if (end - p < 5 || s[p] != "F" || s[p + 1] != "A" || s[p + 2] != "L" || s[p + 3] != "A" || s[p + 4] != " ") {
            revert SubjectMalformed();
        }
        p += 5;

        uint256 q = p;
        while (q < end && s[q] != " ") q++;
        if (_eqAscii(s, p, q, "APPROVE")) verb = VERB_APPROVE;
        else if (_eqAscii(s, p, q, "DENY")) verb = VERB_DENY;
        else if (_eqAscii(s, p, q, "FREEZE")) verb = VERB_FREEZE;
        else revert SubjectMalformed();
        if (q >= end) revert SubjectMalformed();
        p = q + 1;

        q = p;
        while (q < end && s[q] != " ") q++;
        if (q == p || q - p > 18 || q >= end) revert SubjectMalformed();
        if (s[p] == "0" && q - p > 1) revert SubjectMalformed();
        for (uint256 i = p; i < q; i++) {
            uint8 c = uint8(s[i]);
            if (c < 0x30 || c > 0x39) revert SubjectMalformed();
            id = id * 10 + (c - 0x30);
        }
        p = q + 1;

        if (verb == VERB_FREEZE ? id != 0 : id == 0) revert SubjectMalformed();
        if (end - p != 8) revert SubjectMalformed();
        uint32 v;
        for (uint256 i = p; i < end; i++) {
            uint8 c = uint8(s[i]);
            uint8 n;
            if (c >= 0x30 && c <= 0x39) n = c - 0x30;
            else if (c >= 0x61 && c <= 0x66) n = c - 0x61 + 10;
            else revert SubjectMalformed();
            v = (v << 4) | n;
        }
        code = bytes4(v);
    }

    function _lc(bytes1 c) private pure returns (bytes1) {
        return (c >= 0x41 && c <= 0x5a) ? bytes1(uint8(c) + 32) : c;
    }

    function _eqAscii(bytes memory s, uint256 a, uint256 z, bytes memory lit) private pure returns (bool) {
        if (z - a != lit.length) return false;
        for (uint256 i = 0; i < lit.length; i++) {
            if (s[a + i] != lit[i]) return false;
        }
        return true;
    }

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        for (uint256 t = v; t != 0; t /= 10) digits++;
        bytes memory out = new bytes(digits);
        while (v != 0) {
            out[--digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(out);
    }

    function _hex8(bytes4 c) private pure returns (string memory) {
        bytes memory out = new bytes(8);
        bytes16 sym = "0123456789abcdef";
        for (uint256 i = 0; i < 4; i++) {
            out[2 * i] = sym[uint8(c[i]) >> 4];
            out[2 * i + 1] = sym[uint8(c[i]) & 0x0f];
        }
        return string(out);
    }
}
