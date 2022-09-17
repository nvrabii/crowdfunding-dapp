# Sandbox crowdfunding dapp

A sandbox project to try out technologies from the Web3 development stack:

- Solidity (smart contract language)
- Mocha (JS test framework)
- Truffle (smart contract framework / environment), and
- Ganache (personal Ethereum blockchain)

## Scope

The main goal is to create a crowdfunding Solidity smart contract that will allow users to:

1. create funding campaigns (e.g. provide expected amount, ending time)
2. donate to an open campaign
3. withdraw donation (for example, the donator changes his/her mind)
4. close the campaign before the ending time (with a freeze on the funds, in the case some donators change their mind)
5. redeem the collected donations (also after a specific period of time)

## Useful commands

### Run tests

Before executing the tests, run Ganache or another local blockchain daemon.

```zsh
truffle test
```
