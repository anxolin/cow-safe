import 'dotenv/config'

import { Wallet, BigNumber } from "ethers";
import { strict as assert } from 'node:assert';

import { CowSdk, OrderKind } from '@cowprotocol/cow-sdk'
import { OrderBalance } from '@cowprotocol/contracts';
import { GPv2Settlement as settlementAddresses, GPv2VaultRelayer as vaultAddresses } from '@cowprotocol/contracts/networks.json'

import { Settlement__factory, Erc20__factory } from './abi/types';

const MAX_U32 = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
const MNEMONIC = process.env.MNEMONIC
const NETWORK = process.env.NETWORK

const APP_DATA = process.env.APP_DATA || '0x0000000000000000000000000000000000000000000000000000000000000000'
const DEADLINE_OFFSET = 30 * 60 * 1000 // 30min

async function run() {
  assert(MNEMONIC, 'MNEMONIC environment var is required')
  assert(NETWORK && NETWORK === '1' || NETWORK === '4' || NETWORK === '5' || NETWORK === '100', 'NETWORK environment must be a valid chain id')

  const wallet = Wallet.fromMnemonic(MNEMONIC)
  const cowSdk = new CowSdk(parseInt(NETWORK), { signer: wallet })
  console.log('CoW SDK context', cowSdk.context)
  // const mockQuoteResult = {"quote":{"sellToken":"0xc778417e063141139fce010982780140aa0cd5ab","buyToken":"0x4dbcdf9b62e891a7cec5a2568c3f4faf9e8abe2b","receiver":"0xbbd50f14aa90d2d21329367cfd6710c92b9d1fda","sellAmount":"999724034906366998","buyAmount":"164577689090780","validTo":1658161259,"appData":"0x0000000000000000000000000000000000000000000000000000000000000000","feeAmount":"275965093633002","kind":"sell","partiallyFillable":false,"sellTokenBalance":"erc20","buyTokenBalance":"erc20"},"from":"0xbbd50f14aa90d2d21329367cfd6710c92b9d1fda","expiration":"2022-07-18T16:04:06.000748427Z","id":26755}

  const account =  wallet.address

  // TODO: Read order from JSON. For now hardcoded to sell 0.1 WETH for USDC
  const sellTokenAddress = '0xc778417E063141139Fce010982780140Aa0cD5Ab' // WETH
  const buyTokenAddress = '0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b' // USDC
  const sellAmount = '100000000000000000'

  console.log(`CoW SDK initialized. Account: ${account}: ${NETWORK}`)
  console.log('Config', {
    appData: APP_DATA
  })

  const quoteOrder = {
    // Type of order
    partiallyFillable: false,
    kind: OrderKind.SELL,
    sellTokenBalance: OrderBalance.ERC20,
    buyTokenBalance: OrderBalance.ERC20,

    // Limit order
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    amount: sellAmount, // 1 WETH // TODO: Why this is required??
    sellAmountBeforeFee: sellAmount, // 1 WETH

    // Trader
    from: account,
    receiver: account,

    // Deadline
    validTo: Math.ceil((Date.now() + DEADLINE_OFFSET) / 1000),

    // Metadata
    appData: APP_DATA
  }

  console.log('quoteOrder', JSON.stringify(quoteOrder))
//   const quoteResponse = await cowSdk.cowApi.getQuote(quoteOrder)
//   console.log('quoteResponse', JSON.stringify(quoteResponse))
  
//   const { buyAmount, sellAmount, feeAmount } = quoteResponse.quote

//   // Prepare the RAW order
//   const rawOrder = {
//     ...quoteOrder,

//     // Limit Price
//     //    TODO: apply some slippage
//     sellAmount,
//     buyAmount, 

//     // Fee
//     feeAmount,    
//     priceQuality: "optimal"
//   }

//   // Sign the order
//   const { signature, signingScheme } = await cowSdk.signOrder(rawOrder)
//   assert(signature, 'signOrder must return the signature')

//   console.log('Raw order', rawOrder)
//   console.log('Signed order', {signature, signingScheme})

//   // Post order
//   const orderId = await cowSdk.cowApi.sendOrder({
//     order: {
//       ...rawOrder,
//       signature,
//       signingScheme
//     },
//     owner: account
//   })

  const orderId = '0x0d6f18a97690de9d70cdfe00231ee6baf722a12669f3260fb1faf3d2e25dca38' // mock


  // Show link to explorer
  console.log(`🚀 The order has been submitted. See https://explorer.cow.fi/tx/${orderId}
See full history in https://explorer.cow.fi/address/${account}`)

  const dataBundle: string[] = []

  // TODO: if Ether, WRAP

  // TODO: Decide if we need to include do approval
  // Get approval data
  const vaultAddress = vaultAddresses[NETWORK].address
  const sellToken = Erc20__factory.connect(sellTokenAddress, wallet)
  
  // Check allowance (decide if approve sellToken is required)
  const allowance = BigNumber.from('200000000000000000')
  // const allowance = await sellToken.allowance(account, vaultAddress)
  if (allowance.lt(sellAmount)) {
    // Get the approve data
    const approveData = sellToken.interface.encodeFunctionData('approve', [vaultAddress, MAX_U32])
    console.log('approveData: ', approveData)
    dataBundle.push(approveData)
  }


  // GEt Pre-sign order data
  const settlementAddress = settlementAddresses[NETWORK].address
  console.log('GPv2Settlement', settlementAddress)
  const settlement = Settlement__factory.connect(settlementAddress, wallet)
  const preSignData = settlement.interface.encodeFunctionData('setPreSignature', [orderId, true])
  console.log('preSignData: ', preSignData)
  dataBundle.push(preSignData)
  

  // Pre-sign data
  if (dataBundle.length > 1) {
    // TODO: Multicall
  } else {
    // TODO: Simple tx
  }
}

run().catch(console.error)




