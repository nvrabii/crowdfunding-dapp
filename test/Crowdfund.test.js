const Crowdfund = artifacts.require('Crowdfund');

const WITHDRAWAL_DELAY = 2 * 7 * 24 * 60 * 60; // 2 weeks
const CLOSURE_DELAY = 4 * 7 * 24 * 60 * 60; // 4 weeks
const ACCEPTED_TIME_ERROR = 2; // 2 seconds

contract('Crowdfund', (accounts) => {

	describe('Open campaign test cases', async () => {
		let crowdfund;

		const expectedTargetAmount = 100;
		const campaignDuration = 10 * 24 * 60 * 60;
		let expectedClosureTimestamp;
		let expectedNewClosureTimestamp;

		let beneficiary = accounts[0];
		let donator = accounts[1];

		before(async () => {
			const newCrowdfund = await Crowdfund.new(expectedTargetAmount, campaignDuration, { from: beneficiary });
			crowdfund = await Crowdfund.at(newCrowdfund.address);

			const creationTimestamp = await crowdfund.creationTimestamp();
			expectedClosureTimestamp = creationTimestamp.toNumber() + campaignDuration;
		});

		it('Should return correct initial metadata about the campaign', async () => {
			const collectedAmount = await crowdfund.collectedAmount();
			const targetAmount = await crowdfund.targetAmount();
			const rescheduledClosure = await crowdfund.rescheduledClosure();
			const closureTimestamp = await crowdfund.closureTimestamp();

			assert.equal(collectedAmount, 0);
			assert.equal(targetAmount, expectedTargetAmount);
			assert(!rescheduledClosure);
			assert(closureTimestamp, expectedClosureTimestamp);
		});

		it('Should change the state of the campaign via donation', async () => {
			const donation = 100;

			await crowdfund.donate({ from: donator, value: donation });

			const collectedAmount = await crowdfund.collectedAmount();
			const donatedFunds = await crowdfund.collectedFunds(donator);

			assert.equal(collectedAmount.toNumber(), donation);
			assert.equal(donatedFunds.toNumber(), donation);
		});

		it('Should freeze funds after withdrawal request',
			async () => await testFundsFreezeAfterScheduleWithdrawal({ crowdfund, donator })
		);

		it('Should not allow withdrawal before the saved timestamp', async () => {
			try {
				await crowdfund.withdraw({ from: donator });
				assert(false);
			} catch (error) {
				assert(error.message.includes('Message sender cannot withdraw the donation before the scheduled withdrawal time'));
			};
		});

		it('Should close an open campaign', async () => {
			const currentBlockTimestamp = await crowdfund.creationTimestamp();
			const interval = 60 * 60;
			await advanceBlockAtTime(currentBlockTimestamp.toNumber() + interval);

			expectedNewClosureTimestamp = currentBlockTimestamp.toNumber() + interval + CLOSURE_DELAY;

			const { logs } = await crowdfund.close({ from: beneficiary });
			const log = logs[0];

			const closureTimestamp = await crowdfund.closureTimestamp();
			const rescheduledClosure = await crowdfund.rescheduledClosure();

			assert.equal(log.event, "CrowdfundClosure");
			assert(Math.abs(log.args.closureTimestamp.toNumber() - expectedNewClosureTimestamp) < ACCEPTED_TIME_ERROR);
			assert(Math.abs(closureTimestamp.toNumber() - expectedNewClosureTimestamp) < ACCEPTED_TIME_ERROR);
			assert(rescheduledClosure);
		});
	});

	describe('Scheduled for closure campaign test cases', async () => {
		let crowdfund;
		const targetAmount = 100;
		const campaignDuration = 10 * 24 * 60 * 60;
		let beneficiary = accounts[0];
		let donator = accounts[1];

		before(async () => {
			const newCrowdfund = await Crowdfund.new(targetAmount, campaignDuration, { from: beneficiary });
			crowdfund = await Crowdfund.at(newCrowdfund.address);

			creationTimestamp = (await crowdfund.creationTimestamp()).toNumber();

			await crowdfund.close({ from: beneficiary });
			closureTimestamp = (await crowdfund.closureTimestamp({ from: beneficiary })).toNumber();
		});

		it('Should be able to donate', async () => {
			const amount = 42;

			await crowdfund.donate({ from: donator, value: 42 });

			const collectedAmount = (await crowdfund.collectedAmount()).toNumber();
			const collectedFunds = (await crowdfund.collectedFunds(donator)).toNumber();
			assert.equal(collectedAmount, amount);
			assert.equal(collectedFunds, amount);
		});

		it('Should freeze funds after withdrawal request',
			async () => await testFundsFreezeAfterScheduleWithdrawal({ crowdfund, donator })
		);

		it('Should not close an already scheduled for closure campaign', async () => {
			try {
				await crowdfund.close({ from: beneficiary });
				assert(false);
			} catch (error) {
				assert(error.message.includes('The campaign\'s closure has been already rescheduled'));
			}
		});
	});


	describe('Closed campaign test cases', async () => {
		let crowdfund;
		const targetAmount = 100;
		const campaignDuration = 10 * 24 * 60 * 60;
		let beneficiary = accounts[0];
		let donators = [
			{ from: accounts[1], value: 42 },
			{ from: accounts[2], value: 66 }
		];

		before(async () => {
			const newCrowdfund = await Crowdfund.new(targetAmount, campaignDuration, { from: beneficiary });
			crowdfund = await Crowdfund.at(newCrowdfund.address);

			await crowdfund.close({ from: beneficiary });
			const closureTimestamp = (await crowdfund.closureTimestamp({ from: beneficiary })).toNumber();

			await crowdfund.donate(donators[0]);
			await crowdfund.donate(donators[1]);
			await crowdfund.scheduleWithdrawal({ from: donators[1].from });

			await advanceBlockAtTime(closureTimestamp + 10);
		});

		it('Should be able to redeem', async () => {
			const { logs } = await crowdfund.redeemFunds({ from: beneficiary });
			const log = logs[0];
			const expectedCollectedAmount = donators[0].value;

			assert.equal(log.event, 'RedeemSuccess');
			assert.equal(log.args.amount.toNumber(), expectedCollectedAmount);
		});

		it('Shouldn\'t be able to redeem twice', async () => {
			try {
				await crowdfund.redeemFunds({ from: beneficiary });
				assert(false);
			} catch (error) {
				assert(error.message.includes('Funds have been already redeemed'));
			}
		});

		it('Should be able to withdraw', async () => {
			const { logs } = await crowdfund.withdraw({ from: donators[1].from });
			const log = logs[0];
			const frozenAmount = (await crowdfund.frozenAmount()).toNumber();

			assert.equal(log.event, 'WithdrawalSuccess');
			assert.equal(log.args.donator, donators[1].from);
			assert.equal(log.args.amount, donators[1].value);
			assert.equal(frozenAmount, 0);
		});

		it('Shouldn\'t be able to donate', async () => {
			try {
				await crowdfund.donate(donators[1]);
				assert(false);
			} catch (error) {
				assert(error.message.includes('Cannot execute this call: the campaign has been closed'));
			}
		});

		it('Shouldn\'t be able to schedule withdrawal', async () => {
			try {
				await crowdfund.scheduleWithdrawal({ from: donators[0].from });
				assert(false);
			} catch (error) {
				assert(error.message.includes('Cannot execute this call: the campaign has been closed'));
			}
		})
	});
});

const advanceBlockAtTime = (time) => {
	return new Promise((resolve, reject) => {
		web3.currentProvider.send(
			{
				jsonrpc: "2.0",
				method: "evm_mine",
				params: [time],
				id: new Date().getTime(),
			},
			(err, _) => err ? reject(err) : resolve(web3.eth.getBlock("latest").hash),
		);
	});
};

async function testFundsFreezeAfterScheduleWithdrawal({ crowdfund, donator }) {
	const expectedFrozenAmount = await crowdfund.collectedFunds(donator);

	const { logs } = await crowdfund.scheduleWithdrawal({ from: donator });

	const log = logs[0];
	const frozenAmount = await crowdfund.frozenAmount();
	const collectedAmount = await crowdfund.collectedAmount();
	const scheduledWithdrawal = await crowdfund.scheduledWithdrawals(donator);
	const creationTimestamp = await crowdfund.creationTimestamp();
	const expectedAvailableFrom = creationTimestamp.toNumber() + WITHDRAWAL_DELAY;

	assert.equal(log.event, 'ScheduledWithdrawal');
	assert.equal(log.args.donator, donator);
	assert(Math.abs(log.args.availableFrom.toNumber() - expectedAvailableFrom) < ACCEPTED_TIME_ERROR);
	assert(Math.abs(scheduledWithdrawal.toNumber() - expectedAvailableFrom) < ACCEPTED_TIME_ERROR);
	assert.equal(frozenAmount.toNumber(), expectedFrozenAmount.toNumber());
	assert.equal(collectedAmount.toNumber(), 0);
}
