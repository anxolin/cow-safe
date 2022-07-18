import 'dotenv/config'

import { ethers, Wallet } from "ethers";
import { strict as assert } from 'node:assert';

import { CowSdk, OrderKind } from '@cowprotocol/cow-sdk'

const MNEMONIC = process.env.MNEMONIC
const NETWORK = process.env.NETWORK
const APP_DATA = process.env.APP_DATA || '0x0000000000000000000000000000000000000000000000000000000000000000'

assert(MNEMONIC, 'MNEMONIC environment var is required')
assert(NETWORK, 'NETWORK environment var is required')

const DEADLINE_OFFSET = 30 * 60 * 1000 // 30min

const wallet = Wallet.fromMnemonic(MNEMONIC)
const cowSdk = new CowSdk(parseInt(NETWORK), { signer: wallet })
const mockQuoteResult = {"quote":{"sellToken":"0xc778417e063141139fce010982780140aa0cd5ab","buyToken":"0x4dbcdf9b62e891a7cec5a2568c3f4faf9e8abe2b","receiver":"0xbbd50f14aa90d2d21329367cfd6710c92b9d1fda","sellAmount":"999724034906366998","buyAmount":"164577689090780","validTo":1658161259,"appData":"0x0000000000000000000000000000000000000000000000000000000000000000","feeAmount":"275965093633002","kind":"sell","partiallyFillable":false,"sellTokenBalance":"erc20","buyTokenBalance":"erc20"},"from":"0xbbd50f14aa90d2d21329367cfd6710c92b9d1fda","expiration":"2022-07-18T16:04:06.000748427Z","id":26755}
import { OrderBalance } from '@cowprotocol/contracts';



async function run() {
  // const trader = '0x68ac5adfd66afa7bf79964cbb6defd91659dc54e'
  // const trades = await cowSdk.cowApi.getOrders({
  //   owner: trader,
  //   limit: 5,
  //   offset: 0,
  // })
  // console.log(`Trades for ${trader}: ${trades.map(t => t.uid).join(', ')}`)
  const account =  wallet.address

  console.log(`CoW SDK initialized. Account: ${account}: ${NETWORK}`)

  const quoteOrder = {
    // Type of order
    partiallyFillable: false,
    kind: OrderKind.SELL,
    sellTokenBalance: OrderBalance.ERC20,
    buyTokenBalance: OrderBalance.ERC20,

    // Limit order
    sellToken: '0xc778417E063141139Fce010982780140Aa0cD5Ab', // WETH
    buyToken: '0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b', // USDC

    amount: '1000000000000000000', // 1 WETH // TODO: Why this is required??
    sellAmountBeforeFee: '1000000000000000000', // 1 WETH

    // Trader
    from: account,
    receiver: account,

    // Deadline
    validTo: Math.ceil((Date.now() + DEADLINE_OFFSET) / 1000),

    // Metadata
    appData: APP_DATA
  }

  console.log('quoteOrder', JSON.stringify(quoteOrder))
  const quoteResponse = await cowSdk.cowApi.getQuote(quoteOrder)
  console.log('quoteResponse', JSON.stringify(quoteResponse))
  
  const { buyAmount, sellAmount, feeAmount } = quoteResponse.quote

  // Prepare the RAW order
  const rawOrder = {
    ...quoteOrder,

    // Limit Price
    //    TODO: apply some slippage
    sellAmount,
    buyAmount, 

    // Fee
    feeAmount,    
    priceQuality: "optimal"
  }

  // Sign the order
  const signedOrder = await cowSdk.signOrder(rawOrder)

  console.log('Raw order', rawOrder)
  console.log('Signed order', signedOrder)
}

run().catch(console.error)




