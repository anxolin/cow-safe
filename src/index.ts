import 'dotenv/config'

import { Wallet, BigNumber, ethers } from "ethers";

import { strict as assert } from 'node:assert';

import { CowSdk, OrderKind } from '@cowprotocol/cow-sdk'
import { OrderBalance } from '@cowprotocol/contracts';
import { GPv2Settlement as settlementAddresses, GPv2VaultRelayer as vaultAddresses } from '@cowprotocol/contracts/networks.json'

import { Settlement__factory, Erc20__factory } from './abi/types';

const MAX_U32 = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
const SUPPORTED_CHAIN_IDS = [1, 4, 5, 100]
type ChainId = 1 | 4 | 5 | 100

const APP_DATA = process.env.APP_DATA || '0x0000000000000000000000000000000000000000000000000000000000000000'
const DEADLINE_OFFSET = 30 * 60 * 1000 // 30min

type AccoutType = 'EOA' | 'SAFE' | 'SAFE_WITH_EOA_PROPOSER'

interface AccountParams {
  accountType: AccoutType
  safeAddress?: string // TODO: not used yet. It will allow to specify the Gnosis Safe address for SAFE_WITH_EOA_PROPOSER setup
}

interface LimitOrderParams {
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount?: string
  partiallyFillable?: boolean
}

interface OrderParams {
  chainId?: ChainId
  account: AccountParams
  order: LimitOrderParams  
}


function getProvider(chainId: ChainId): ethers.providers.Provider {
    const infuraKey = process.env.INFURA_KEY
    const rpcUrl = process.env.RPC_URL
    if (infuraKey) {
      return new ethers.providers.InfuraProvider(chainId, infuraKey)
    } else if (rpcUrl) {
      return new ethers.providers.InfuraProvider(chainId, infuraKey)
    } else {
      throw new Error('Either INFURA_KEY or RPC_URL environment var is required')
    }
    
    assert(rpcUrl, )
}

function getSigner(accoutType: AccoutType, provider: ethers.providers.Provider): Wallet | undefined {
  switch (accoutType) {
    case 'EOA':
    case 'SAFE_WITH_EOA_PROPOSER':
      const mnemonic = process.env.MNEMONIC
      assert(mnemonic, 'MNEMONIC environment var is required for accountTypes EOA or SAFE_WITH_EOA_PROPOSER')
      const wallet = Wallet.fromMnemonic(mnemonic)
      wallet.connect(provider)

      return wallet
    case 'SAFE':
      return undefined
    default:
      break;
  }
}

function getChainIdFromEnv(): ChainId {
  const chainIdEnv = process.env.CHAIN_ID
  assert(chainIdEnv, 'CHAIN_ID environmentis required')
  const chainId = parseInt(chainIdEnv)
  assert(chainIdEnv && SUPPORTED_CHAIN_IDS.includes(chainId) , 'CHAIN_ID must be one supported chainId. Supported: ' + SUPPORTED_CHAIN_IDS.join(', '))

  return chainId as ChainId
}


function getOrder(): OrderParams {
  // TODO: For now mocked, it would load this info from a file in future PRs
  return {
    chainId: 4, // Rinkeby
    account: {
      accountType: 'EOA'
    },
    order: {
      sellToken: '0xc778417E063141139Fce010982780140Aa0cD5Ab', // WETH
      buyToken: '0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b', // USDC
      sellAmount: '100000000000000000', // 0.1 WETH
      partiallyFillable: true,
      // buyAmount, // Empty to get the price. TODO: add buyAmount support, or add slippage
    }
  }
}

async function run() {
  // Get order definition
  const { chainId = getChainIdFromEnv(), account, order } = getOrder()

  // Get Provider/Signer
  const provider = getProvider(chainId)
  const signer = getSigner(account.accountType, provider)
  const signerOrProvider = signer || provider

  // Instantiate SDK
  const cowSdk = new CowSdk(chainId, { signer })
  console.log('CoW SDK context', cowSdk.context)
  const signerAddress = signer?.address


  console.log(`CoW SDK initialized. Account: ${signerAddress ? signerAddress : 'Undefined'}, Network: ${chainId}`)
  console.log('Config', {
    appData: APP_DATA
  })

  
  const { sellToken: sellTokenAddress, buyToken: buyTokenAddress, sellAmount, partiallyFillable = false } = order
  const quoteOrder = {
    // Type of order
    partiallyFillable,
    kind: OrderKind.SELL,
    sellTokenBalance: OrderBalance.ERC20,
    buyTokenBalance: OrderBalance.ERC20,

    // Limit order
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    amount: sellAmount, // 1 WETH // TODO: Why this is required??
    sellAmountBeforeFee: sellAmount, // 1 WETH

    // Trader
    from: signerAddress,
    receiver: signerAddress,

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

    // const mockQuoteResult = {"quote":{"sellToken":"0xc778417e063141139fce010982780140aa0cd5ab","buyToken":"0x4dbcdf9b62e891a7cec5a2568c3f4faf9e8abe2b","receiver":"0xbbd50f14aa90d2d21329367cfd6710c92b9d1fda","sellAmount":"999724034906366998","buyAmount":"164577689090780","validTo":1658161259,"appData":"0x0000000000000000000000000000000000000000000000000000000000000000","feeAmount":"275965093633002","kind":"sell","partiallyFillable":false,"sellTokenBalance":"erc20","buyTokenBalance":"erc20"},"from":"0xbbd50f14aa90d2d21329367cfd6710c92b9d1fda","expiration":"2022-07-18T16:04:06.000748427Z","id":26755}


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

  const orderId = '0xb9168d8014ab422f8b6e5d69dd618292a0b4c09b2d235a64a64a99e5817b02ba84e5c8518c248de590d5302fd7c32d2ae6b0123c627272e8' // mock


  // Show link to explorer
  console.log(`🚀 The order has been submitted. See https://explorer.cow.fi/orders/${orderId}
See full history in https://explorer.cow.fi/address/${signerAddress}`)

  const dataBundle: string[] = []

  // TODO: if Ether, WRAP

  // TODO: Decide if we need to include do approval
  // Get approval data
  const vaultAddress = vaultAddresses[chainId].address
  const sellToken = Erc20__factory.connect(sellTokenAddress, signerOrProvider)
  
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
  const settlementAddress = settlementAddresses[chainId].address
  console.log('GPv2Settlement', settlementAddress)
  const settlement = Settlement__factory.connect(settlementAddress, signerOrProvider)
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




