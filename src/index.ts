import 'dotenv/config'

import { ethers, Wallet } from "ethers";
import { strict as assert } from 'node:assert';

import { CowSdk } from '@cowprotocol/cow-sdk'

const MNEMONIC = process.env.MNEMONIC
const NETWORK = process.env.NETWORK

assert(MNEMONIC, 'MNEMONIC environment var is required')
assert(NETWORK, 'NETWORK environment var is required')

const cowSdk = new CowSdk(parseInt(NETWORK))
const wallet = Wallet.fromMnemonic(MNEMONIC)

async function run() {
  const trader = '0x68ac5adfd66afa7bf79964cbb6defd91659dc54e'
  const trades = await cowSdk.cowApi.getOrders({
    owner: trader,
    limit: 5,
    offset: 0,
  })

  console.log(`Trades for ${trader}: ${trades.map(t => t.uid).join(', ')}`)
}

run().catch(console.error)