import 'dotenv/config'

import { Wallet, BigNumber, ethers } from "ethers";
const chalk = require('chalk')

import { strict as assert } from 'node:assert';

import { CowSdk, OrderKind } from '@cowprotocol/cow-sdk'
import { OrderBalance, SigningScheme } from '@cowprotocol/contracts';
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
  appData?: string
  receiver?: string
}

interface OrderParams {
  chainId?: ChainId
  account: AccountParams
  order: LimitOrderParams  
}

interface OnchainOperation {
  description: string
  data: string
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

      return wallet.connect(provider)
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
      partiallyFillable: false,
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
  const signingAccount = signer?.address
  const signerOrProvider = signer || provider

  // Instantiate SDK
  const cowSdk = new CowSdk(chainId, { signer })
  console.log(`${chalk.red('CoW SDK')} ${chalk.cyan('initialized')}. Signing Account: ${chalk.blue(signingAccount ? signingAccount : 'Undefined')}, Network: ${chalk.blue(chainId)}`)

  const {
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmount,
    receiver: receiverParam,
    partiallyFillable = false,
    appData = process.env.APP_DATA || APP_DATA
  } = order
  

  // Decide what it sthe fromAccount and receiver
  let fromAccount, receiver
  if (account.accountType === 'EOA') {
    assert(signingAccount, `The signer address is missing`)
    fromAccount = signingAccount
    receiver = receiverParam || fromAccount
  } else {
    assert(account.safeAddress, `The safeAddress is a required parameter for account type: ${account.accountType}`)
    fromAccount = account.safeAddress
    receiver = receiverParam || fromAccount
  }

  // Prepare quote order
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
    from: fromAccount,
    receiver: receiver,

    // Deadline
    validTo: Math.ceil((Date.now() + DEADLINE_OFFSET) / 1000),

    // Metadata
    appData
  }

  // Get quote
  console.log(`${chalk.cyan('Get quote for order')}:\n${JSON.stringify(quoteOrder, null, 2)}`)
  const quoteResponse = await cowSdk.cowApi.getQuote(quoteOrder)
  const { buyAmount, feeAmount } = quoteResponse.quote
  console.log(`${chalk.cyan('Quote response')}: Receive at least ${chalk.blue(buyAmount)} buy tokens. Fee = ${chalk.blue(feeAmount)}\n${JSON.stringify(quoteResponse, null, 2)} sell tokens.`)
  
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
  console.log(`${chalk.cyan('Raw order')}: \n${JSON.stringify(rawOrder, null, 2)}`)

  let orderId
  const dataBundle: OnchainOperation[] = []
  // Get approval data
  const vaultAddress = vaultAddresses[chainId].address
  const sellToken = Erc20__factory.connect(sellTokenAddress, signerOrProvider)
  
  // Check allowance (decide if approve sellToken is required)
  const allowance = await sellToken.allowance(fromAccount, vaultAddress)
  if (allowance.lt(sellAmount)) {
    // Get the approve data
    dataBundle.push({
      description: 'Approve sell token',
      data: sellToken.interface.encodeFunctionData('approve', [vaultAddress, MAX_U32])
    })
  }

  if (account.accountType === 'SAFE' || account.accountType === 'SAFE_WITH_EOA_PROPOSER') {
    // Post pre-sign order
    orderId = await cowSdk.cowApi.sendOrder({
      order: {
        ...rawOrder,
        signature: fromAccount, // TODO: I believe the signature is not required for pre-sign any more, but the SDK hasn't been updated
        signingScheme: SigningScheme.PRESIGN
      },
      owner: signingAccount as string
    })

    // Get Pre-sign order data
    const settlementAddress = settlementAddresses[chainId].address
    const settlement = Settlement__factory.connect(settlementAddress, signerOrProvider)
    dataBundle.push({
      description: 'Pre-sign order',
      data: settlement.interface.encodeFunctionData('setPreSignature', [orderId, true])
    })
  }
  
  // // Pre-sign data
  // if (dataBundle.length > 1) {
  //   // TODO: Multicall
  // } else {
  //   // TODO: Simple tx
  // }

  if (account.accountType === 'EOA') {
    const txTotal = dataBundle.length
    console.log(`\n\n${chalk.cyan(`${chalk.red(txTotal)} transactions need to be executed`)} before the order can be posted:\n`)
    let txNumber = 1
    for (const { data, description } of dataBundle) {
      console.log(`    [${txNumber}/${txTotal}] ${chalk.cyan('Are you sure you want to')} ${chalk.blue(description)}?}`)
      console.log(`          ${chalk.bold('Tx Data')}: ${data}`)
      console.log(`Approve transaction? ${chalk.italic('(y/n)')}`)
      txNumber++
    }

    // Sign the order
    const { signature, signingScheme } = await cowSdk.signOrder(rawOrder)
    assert(signature, 'signOrder must return the signature')    
    console.log('Signed order', {signature, signingScheme})

    // Post order
    orderId = await cowSdk.cowApi.sendOrder({
      order: {
        ...rawOrder,
        signature,
        signingScheme
      },
      owner: signingAccount as string
    })
  } else {
    throw new Error('Not implemented')
  }
  

  orderId = '0xb9168d8014ab422f8b6e5d69dd618292a0b4c09b2d235a64a64a99e5817b02ba84e5c8518c248de590d5302fd7c32d2ae6b0123c627272e8' // mock

  // Show link to explorer
  console.log(`🚀 ${chalk.cyan('The order has been submitted')}. See ${chalk.blue('https://explorer.cow.fi/orders/' + orderId)}
              See ${chalk.underline('full history')} in ${chalk.blue('https://explorer.cow.fi/address/' + fromAccount)}`)
}

run().catch(console.error)




