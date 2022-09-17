const Crowdfund = artifacts.require("CrowdfundMock");

const CAMPAIGN_DURATION = 10 * 24 * 60 * 60; // 10 days
const WITHDRAWAL_DELAY = 2 * 7 * 24 * 60 * 60; // 2 weeks
const CLOSURE_DELAY = 4 * 7 * 24 * 60 * 60; // 4 weeks
const ACCEPTED_TIME_ERROR = 2; // 2 seconds

const TARGET_AMOUNT = web3.utils.toWei("1000", "wei"); // 1e-15 ether

contract("Crowdfund", (accounts) => {
  let crowdfund;
  let creationTimestamp;
  let expectedClosureTimestamp;

  const beneficiary = accounts[0];

  describe("Open campaign", async () => {
    const donator = accounts[1];

    before(async () => {
      // create a new fund
      crowdfund = await Crowdfund.new(TARGET_AMOUNT, CAMPAIGN_DURATION, {
        from: beneficiary,
      });
      creationTimestamp = (await crowdfund.creationTimestamp()).toNumber();
      expectedClosureTimestamp = creationTimestamp + CAMPAIGN_DURATION;
    });

    it("should return correct initial metadata", async () => {
      const collectedAmount = await crowdfund.collectedAmount();
      const targetAmount = await crowdfund.targetAmount();
      const rescheduledClosure = await crowdfund.rescheduledClosure();
      const closureTimestamp = await crowdfund.closureTimestamp();

      assert.equal(collectedAmount, 0);
      assert.equal(TARGET_AMOUNT, targetAmount);
      assert(!rescheduledClosure);
      assert.equal(closureTimestamp.toNumber(), expectedClosureTimestamp);
    });

    it("should donate", async () => {
      const donation = 100;

      await crowdfund.donate({ from: donator, value: donation });

      const collectedAmount = await crowdfund.collectedAmount();
      const donatedFunds = await crowdfund.collectedFunds(donator);

      assert.equal(collectedAmount.toNumber(), donation);
      assert.equal(donatedFunds.toNumber(), donation);
    });

    it("should freeze funds after withdrawal request", async () =>
      await testFundsFreezeAfterScheduleWithdrawal({ crowdfund, donator }));

    it("should not allow withdrawal before the saved timestamp", async () => {
      try {
        await crowdfund.withdraw({ from: donator });
        assert(false);
      } catch (error) {
        assert(
          error.message.includes(
            "Message sender cannot withdraw the donation before the scheduled withdrawal time"
          )
        );
      }
    });

    it("should close an open campaign", async () => {
      const interval = 60 * 60;

      // advance by 1 hour
      await crowdfund.setTime(creationTimestamp + interval);

      const expectedNewClosureTimestamp =
        creationTimestamp + interval + CLOSURE_DELAY;

      const { logs } = await crowdfund.close({ from: beneficiary });
      const log = logs[0];

      const closureTimestamp = await crowdfund.closureTimestamp();
      const rescheduledClosure = await crowdfund.rescheduledClosure();

      assert.equal(log.event, "CrowdfundClosure");
      assertEqualWithError(
        log.args.closureTimestamp.toNumber(),
        expectedNewClosureTimestamp,
        ACCEPTED_TIME_ERROR
      );
      assertEqualWithError(
        closureTimestamp.toNumber(),
        expectedNewClosureTimestamp,
        ACCEPTED_TIME_ERROR
      );
      assert(rescheduledClosure);
    });
  });

  describe("Scheduled for closure campaign", async () => {
    const donator = accounts[1];

    before(async () => {
      // create a new crowdfund
      crowdfund = await Crowdfund.new(TARGET_AMOUNT, CAMPAIGN_DURATION, {
        from: beneficiary,
      });

      // close the fund
      await crowdfund.close({ from: beneficiary });
    });

    it("should donate", async () => {
      const amount = 42;

      await crowdfund.donate({ from: donator, value: 42 });

      const collectedAmount = (await crowdfund.collectedAmount()).toNumber();
      const collectedFunds = (
        await crowdfund.collectedFunds(donator)
      ).toNumber();

      assert.equal(collectedAmount, amount);
      assert.equal(collectedFunds, amount);
    });

    it("should freeze funds after withdrawal request", async () =>
      await testFundsFreezeAfterScheduleWithdrawal({ crowdfund, donator }));

    it("should not close an already scheduled for closure campaign", async () => {
      try {
        await crowdfund.close({ from: beneficiary });
        assert(false);
      } catch (error) {
        assert(
          error.message.includes(
            "The campaign's closure has been already rescheduled"
          )
        );
      }
    });
  });

  describe("Closed campaign", async () => {
    const donators = [
      { from: accounts[1], value: 42 },
      { from: accounts[2], value: 66 },
    ];

    before(async () => {
      // create a new crowdfund
      crowdfund = await Crowdfund.new(TARGET_AMOUNT, CAMPAIGN_DURATION, {
        from: beneficiary,
      });
      creationTimestamp = (await crowdfund.creationTimestamp()).toNumber();
      expectedClosureTimestamp = creationTimestamp + CAMPAIGN_DURATION;

      // close the fund
      await crowdfund.close({ from: beneficiary });
      expectedClosureTimestamp = (
        await crowdfund.closureTimestamp({ from: beneficiary })
      ).toNumber();

      // two donators will donate in the 'scheduled for closure' state
      await crowdfund.donate(donators[0]);
      await crowdfund.donate(donators[1]);

      // one donator will schedule a withdrawal
      await crowdfund.scheduleWithdrawal({ from: donators[1].from });

      // set time past expectedClosureTimestamp
      await crowdfund.setTime(expectedClosureTimestamp + 10);
    });

    it("should redeem", async () => {
      const { logs } = await crowdfund.redeemFunds({ from: beneficiary });
      const log = logs[0];
      const expectedCollectedAmount = donators[0].value;

      assert.equal(log.event, "RedeemSuccess");
      assert.equal(log.args.amount.toNumber(), expectedCollectedAmount);
    });

    it("shoul not redeem twice", async () => {
      try {
        await crowdfund.redeemFunds({ from: beneficiary });
        assert(false);
      } catch (error) {
        assert(error.message.includes("Funds have been already redeemed"));
      }
    });

    it("should withdraw", async () => {
      const { logs } = await crowdfund.withdraw({ from: donators[1].from });
      const log = logs[0];
      const frozenAmount = (await crowdfund.frozenAmount()).toNumber();

      assert.equal(log.event, "WithdrawalSuccess");
      assert.equal(log.args.donator, donators[1].from);
      assert.equal(log.args.amount, donators[1].value);
      assert.equal(frozenAmount, 0);
    });

    it("should not donate", async () => {
      try {
        await crowdfund.donate(donators[1]);
        assert(false);
      } catch (error) {
        assert(
          error.message.includes(
            "Cannot execute this call: the campaign has been closed"
          )
        );
      }
    });

    it("should not schedule withdrawal", async () => {
      try {
        await crowdfund.scheduleWithdrawal({ from: donators[0].from });
        assert(false);
      } catch (error) {
        assert(
          error.message.includes(
            "Cannot execute this call: the campaign has been closed"
          )
        );
      }
    });
  });
});

async function testFundsFreezeAfterScheduleWithdrawal({ crowdfund, donator }) {
  const expectedFrozenAmount = await crowdfund.collectedFunds(donator);

  const { logs } = await crowdfund.scheduleWithdrawal({ from: donator });

  const log = logs[0];
  const frozenAmount = await crowdfund.frozenAmount();
  const collectedAmount = await crowdfund.collectedAmount();
  const scheduledWithdrawal = await crowdfund.scheduledWithdrawals(donator);
  const creationTimestamp = await crowdfund.creationTimestamp();
  const expectedAvailableFrom = creationTimestamp.toNumber() + WITHDRAWAL_DELAY;

  assert.equal(log.event, "ScheduledWithdrawal");
  assert.equal(log.args.donator, donator);
  assertEqualWithError(
    log.args.availableFrom.toNumber(),
    expectedAvailableFrom,
    ACCEPTED_TIME_ERROR
  );
  assertEqualWithError(
    scheduledWithdrawal.toNumber(),
    expectedAvailableFrom,
    ACCEPTED_TIME_ERROR
  );
  assert.equal(frozenAmount.toNumber(), expectedFrozenAmount.toNumber());
  assert.equal(collectedAmount.toNumber(), 0);
}

function assertEqualWithError(x, y, error) {
  assert(Math.abs(x - y) < error);
}
