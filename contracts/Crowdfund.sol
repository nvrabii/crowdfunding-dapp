// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

uint256 constant WITHDRAWAL_DELAY = 2 weeks;
uint256 constant CLOSURE_DELAY = 4 weeks;
uint256 constant MIN_CAMPAIGN_DURATION = 1 weeks;
uint256 constant MAX_CAMPAIGN_DURATION = 52 weeks;

contract Crowdfund {
	address payable beneficiary;

	uint256 public collectedAmount;
	uint256 public immutable targetAmount;
	uint256 frozenAmount;
	
	bool public rescheduledClosure;
	uint256 public closureTimestamp;

	mapping(address => uint256) public collectedFunds;
  mapping(address => uint256) public scheduledWithdrawals;

	event ScheduledWithdrawal(address issuer, uint256 availableFrom);
	event WithdrawalSuccess(address donator, uint256 amount);
	event WithdrawalFailure(address donator);
	event CrowdfundClosure(uint256 closureTimestamp);
	event RedeemSuccess(uint256 amount);
	event RedeemFailure();

	modifier isOpen() {
		require(block.timestamp <= closureTimestamp,
			"Cannot execute this call: the campaign has been closed");
		_;
	}

	modifier isClosed() {
		require(block.timestamp > closureTimestamp, "Cannot execute this call: the campaign is not closed yet");
		_;
	}

	modifier isDonator() {
		require (collectedFunds[msg.sender] != 0, "Message sender is not a donator to this fund");
		_;
	}

	modifier isBeneficiary() {
		require(msg.sender == beneficiary, "Message sender is not the beneficiary of the fund");
		_;
	}

	constructor(uint256 target, uint256 duration) {
		require(target > 0, "A new crowdfunding campaign must have a positive target amount");
		require(duration >= MIN_CAMPAIGN_DURATION && duration <= MAX_CAMPAIGN_DURATION,
			"The duration of a new crowdfunding campaign must fit the allowed duration intervals");

		beneficiary = payable(msg.sender);
		targetAmount = target;
		closureTimestamp = block.timestamp + duration;
	}

	function donate() public payable isOpen {
		require(msg.value > 0, "Null donations are not allowed");

		collectedFunds[msg.sender] += msg.value;
		collectedAmount += msg.value;
	}

	function scheduleWithdrawal() public isDonator isOpen {
		require (scheduledWithdrawals[msg.sender] == 0, "Message sender has already scheduled a withdrawal");
		
		scheduledWithdrawals[msg.sender] = block.timestamp + WITHDRAWAL_DELAY;
		collectedAmount -= collectedFunds[msg.sender];
		frozenAmount += collectedFunds[msg.sender];

		emit ScheduledWithdrawal(msg.sender, block.timestamp + WITHDRAWAL_DELAY);
	}

	function withdraw() public isDonator {
		uint256 withdrawalTime = scheduledWithdrawals[msg.sender];

		require (withdrawalTime != 0, "Message sender didn't schedule a withdrawal");
		require (withdrawalTime >= block.timestamp,
			"Message sender cannot withdraw the donation before the scheduled withdrawal time");

		uint256 amount = collectedFunds[msg.sender];
		
		delete collectedFunds[msg.sender];
		delete scheduledWithdrawals[msg.sender];
		frozenAmount -= amount;

		if (payable(msg.sender).send(collectedFunds[msg.sender])) {
			emit WithdrawalSuccess(msg.sender, amount);
		} else {
			collectedFunds[msg.sender] = amount;
			scheduledWithdrawals[msg.sender] = withdrawalTime;
			frozenAmount += amount;

			emit WithdrawalFailure(msg.sender);

			revert("Failed to withdraw the donated funds");
		}
	}

	function close() public isBeneficiary isOpen {
		require(!rescheduledClosure, "The campaign's closure has been already rescheduled");

		rescheduledClosure = true;
		closureTimestamp = block.timestamp + CLOSURE_DELAY;

		emit CrowdfundClosure(closureTimestamp);
	}

	function redeemFunds() public isBeneficiary isClosed {
		uint256 amount = collectedAmount;
		delete collectedAmount;

		if (payable(msg.sender).send(amount)) {
			emit RedeemSuccess(amount);
		} else {
			collectedAmount = amount;

			emit RedeemFailure();

			revert("Failed to redeem the collected funds");
		}
	}

	function min(uint256 x, uint256 y) internal pure returns(uint256) {
		return x < y ? x : y;
	}
}
