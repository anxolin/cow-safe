import 'dotenv/config'

import { strict as assert } from 'node:assert'
import { exit } from 'process'
import * as fs from 'fs/promises'

import * as readline from 'readline'
const chalk = require('chalk')

import { Wallet, BigNumber, ethers } from "ethers"
import { TransactionRequest, TransactionResponse } from "@ethersproject/abstract-provider"

import EthersAdapter from '@gnosis.pm/safe-ethers-lib'
import Safe from '@gnosis.pm/safe-core-sdk'
import SafeServiceClient from '@gnosis.pm/safe-service-client'

import { MetaTransactionData } from '@gnosis.pm/safe-core-sdk-types'


import { CowSdk, OrderKind } from '@cowprotocol/cow-sdk'
import { OrderBalance, SigningScheme, QuoteQuery } from '@cowprotocol/contracts';
import { GPv2Settlement as settlementAddresses, GPv2VaultRelayer as vaultAddresses } from '@cowprotocol/contracts/networks.json'

import { Settlement__factory, Erc20__factory } from './abi/types';

const SUPPORTED_CHAIN_IDS = [1, 4, 5, 100]
type ChainId = 1 | 4 | 5 | 100
const MAX_U32 = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
const TEN_THOUSAND = BigNumber.from('10000')

const APP_DATA = process.env.APP_DATA || '0x0000000000000000000000000000000000000000000000000000000000000000'
const DEADLINE_OFFSET = 30 * 60 * 1000 // 30min
const DEFAULT_SLIPPAGE_BIPS = 100

const NUMBER_CONFIRMATIONS_WAIT = 1

export type AccoutType = 'EOA' | 'SAFE' | 'SAFE_WITH_EOA_PROPOSER'

export interface AccountParams {
  accountType: AccoutType
  safeAddress?: string // TODO: not used yet. It will allow to specify the Gnosis Safe address for SAFE_WITH_EOA_PROPOSER setup
}

export interface LimitOrderParams {
  sellToken: string
  buyToken: string
  sellAmountBeforeFee: string
  buyAmount?: string
  partiallyFillable?: boolean
  appData?: string
  receiver?: string
  slippageToleranceBips?: string
}

export interface OrderParams {
  chainId?: ChainId
  account: AccountParams
  order: LimitOrderParams  
}

export type TxRequest = Pick<MetaTransactionData, 'to' | 'value' | 'data'> // Required<Pick<TransactionRequest, 'to' | 'value' | 'data'>>

export interface OnchainOperation {
  description: string
  txRequest: TxRequest
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string) => new Promise((resolve) => rl.question(query, resolve));
const confirm = async (query: string): Promise<boolean> => {
  const response = await ask(`${query} ${chalk.italic('(y/n)')}: `)
  if (response === 'y' || response === 'Y') return true
  else if (response === 'n' || response === 'N') return false
  else {
    console.log(`${chalk.red(`Invalid response`)}: Please reply with a ${chalk.bold('Y')} or a ${chalk.bold('N')}`)
    return await confirm(query)
  }
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


async function getOrder(orderFilePath: string): Promise<OrderParams> {
  const content = await fs.readFile(orderFilePath)
  return JSON.parse(content.toString()) as OrderParams
}

function getExplorerUrl(chainId: ChainId) {
  switch (chainId) {
    case 1:    
      return 'https://etherscan.io/tx'
    case 4:    
      return 'https://rinkeby.etherscan.io/tx'
    case 5:    
      return 'https://goerli.etherscan.io/tx'
    case 100:    
      return 'https://blockscout.com/xdai/mainnet/tx/'
    default:
      throw new Error('Unknonw network: ' + chainId)
  }
}

function getCowExplorerUrl(chainId: ChainId) {
  switch (chainId) {
    case 1:    
      return 'https://explorer.cow.fi'
    case 4:    
      return 'https://explorer.cow.fi/rinkeby'
    case 5:    
      return 'https://explorer.cow.fi/goerli'
    case 100:    
    return 'https://explorer.cow.fi/gc'
    default:
      throw new Error('Unknonw network: ' + chainId)
  }  
}

function getGnosisSafeServiceUrl(chainId: ChainId) {
  switch (chainId) {
    case 1:    
      return 'https://safe-transaction.gnosis.io'
    case 4:    
      return 'https://safe-transaction.rinkeby.gnosis.io'
    case 5:    
      return 'https://safe-transaction.goerli.gnosis.io'
    case 100:    
    return 'https://safe-transaction.xdai.gnosis.io'
    default:
      throw new Error('Unknonw network: ' + chainId)
  }  
}

function getSafeNetworkShortname(chainId: ChainId) {
  switch (chainId) {
    case 1:    
      return 'eth'
    case 4:    
      return 'rin'
    case 5:    
      return 'gor'
    case 100:    
    return 'gc'
    default:
      throw new Error('Unknonw network: ' + chainId)
  }
}

function printExplorer(orderId: string, fromAccount: string, chainId: ChainId) {
  // Show link to explorer
  const cowExplorerUrl = getCowExplorerUrl(chainId)
  console.log(`\n🚀 ${chalk.cyan('The order has been submitted')}. See ${chalk.blue(`${cowExplorerUrl}/orders/${orderId}`)}
              See ${chalk.underline('full history')} in ${chalk.blue(`${cowExplorerUrl}/address/${fromAccount}`)}`)
}

async function run() {
  const myArgs = process.argv.slice(2)
  if (myArgs.length === 0) {
    console.error(`${chalk.cyan('Missing argument. Path to the order definition JSON file')}. i.e. yarn sell examples/eoa-rinkeby-market-order.json`)
    exit(99)
  }
  const orderFilePath = myArgs[0]

  // Get order definition
  const { chainId = getChainIdFromEnv(), account, order } = await getOrder(orderFilePath)

  // Get Provider/Signer
  const { accountType, safeAddress  } = account
  const provider = getProvider(chainId)
  const signer = getSigner(accountType, provider)
  const signingAccount = signer?.address
  const signerOrProvider = signer || provider

  // Instantiate SDK
  const cowSdk = new CowSdk(chainId, { signer })
  console.log(`${chalk.red('CoW SDK')} ${chalk.cyan('initialized')}. Signing Account: ${chalk.blue(signingAccount ? signingAccount : 'Undefined')}, Network: ${chalk.blue(chainId)}`)

  const {
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmountBeforeFee,
    receiver: receiverParam,
    partiallyFillable = false,
    slippageToleranceBips: slippageToleranceBips = DEFAULT_SLIPPAGE_BIPS,
    appData = process.env.APP_DATA || APP_DATA
  } = order
  

  // Decide what it sthe fromAccount and receiver
  let fromAccount: string, receiver: string
  if (accountType === 'EOA') {
    assert(signingAccount, `The signer address is missing`)
    fromAccount = signingAccount
    receiver = receiverParam || signingAccount
  } else {
    assert(safeAddress, `The safeAddress is a required parameter for account type: ${account.accountType}`)
    fromAccount = safeAddress
    receiver = receiverParam || safeAddress
  }

  // Prepare quote order
  const quoteOrder: QuoteQuery = {
    // Type of order
    partiallyFillable,
    kind: OrderKind.SELL,
    sellTokenBalance: OrderBalance.ERC20,
    buyTokenBalance: OrderBalance.ERC20,

    // Limit order
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmountBeforeFee,

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
  const quoteResponse = await cowSdk.cowApi.getQuote(quoteOrder) // TODO: Fix any here. The SDK requires "amount" which is not required
  const { sellAmount, buyAmount, feeAmount } = quoteResponse.quote
  console.log(`${chalk.cyan('Quote response')}: Receive at least ${chalk.blue(buyAmount)} buy tokens. Fee = ${chalk.blue(feeAmount)}\n${JSON.stringify(quoteResponse, null, 2)} sell tokens.`)

  // Reduce the buyAmount by some slippageToleranceBips
  
  const buyAmountAfterSlippage = BigNumber
    .from(buyAmount)
    .mul(TEN_THOUSAND.sub(BigNumber.from(slippageToleranceBips)))
    .div(TEN_THOUSAND)
  console.log(`${chalk.cyan(`Apply ${chalk.blue(slippageToleranceBips + ' BIPs')} to expected receive tokens`)}. Accepting ${chalk.blue(buyAmountAfterSlippage)}, expected ${chalk.blue(buyAmount)}`)
  
  // Prepare the RAW order
  const rawOrder = {
    ...quoteOrder,
    receiver,

    // Limit Price
    sellAmount, // sellAmount already has the fees deducted
    buyAmount: buyAmountAfterSlippage.toString(),
    sellAmountBeforeFee: undefined,

    // Fee
    feeAmount,    
    priceQuality: "optimal"
  }
  delete rawOrder.sellAmountBeforeFee

  console.log(`${chalk.cyan('Raw order')}: \n${JSON.stringify(rawOrder, null, 2)}`)

  let orderId
  const dataBundle: OnchainOperation[] = []
  // Get approval data
  const vaultAddress = vaultAddresses[chainId].address
  const sellToken = Erc20__factory.connect(sellTokenAddress, signerOrProvider)
  
  // Validate if enough balance
  const sellBalance = await sellToken.balanceOf(fromAccount)
  if (sellBalance.lt(sellAmountBeforeFee)) {
    throw new Error(`User doesn't have enough balance of the sell token. Required ${sellAmountBeforeFee}, balance ${sellBalance}`)
  }
  
  // Check allowance (decide if approve sellToken is required)
  const allowance = await sellToken.allowance(fromAccount, vaultAddress)
  if (allowance.lt(sellAmount)) {
    // Get the approve data
    dataBundle.push({
      description: 'Approve sell token',
      txRequest: {
        to: sellTokenAddress,
        value: '0',
        data: sellToken.interface.encodeFunctionData('approve', [vaultAddress, MAX_U32])
      }
    })
  }


  if (account.accountType === 'EOA') {
    assert(signer)
    const txTotal = dataBundle.length    
    if (txTotal > 0) {
      console.log(`\n\n${chalk.cyan(`${chalk.red(txTotal)} transactions need to be executed`)} before the order can be posted:\n`)
      let txNumber = 1
      for (const { txRequest, description } of dataBundle) {
        const { to, data } = txRequest
        console.log(`    [${txNumber}/${txTotal}] ${chalk.cyan('Are you sure you want to')} ${chalk.blue(description)}?}`)
        console.log(`          ${chalk.bold('To')}: ${to}`)
        console.log(`          ${chalk.bold('Tx Data')}: ${data}`)
        txNumber++
        const sendTransaction = await confirm(`    Approve transaction?`)
        if (sendTransaction) {        
          const txResponse = await signer.sendTransaction({
            from: signingAccount,
            to,
            data
          })
          // console.log(JSON.stringify(txResponse, null, 2))
          console.log(`    Sent transaction for ${chalk.blue(description)}. Review in block explorer: ${chalk.blue(getExplorerUrl(chainId) + '/' + txResponse.hash)}`)
          await txResponse.wait()
          console.log(`    🎉 ${chalk.cyan('Transactions was mined!')} waiting for ${chalk.red(NUMBER_CONFIRMATIONS_WAIT)} confirmations before continuing`)
          await txResponse.wait(NUMBER_CONFIRMATIONS_WAIT)
        } else {
          console.log(chalk.cyan('\nUnderstood! Not sending the transaction. Have a nice day 👋'))
          exit(100)
        }
      }
    }

    const postOrder = await confirm(`${chalk.cyan('Are you sure you want to post this order?')}`)
    if (postOrder) {
      // Sign the order
      const { signature, signingScheme } = await cowSdk.signOrder(rawOrder)
      assert(signature, 'signOrder must return the signature')

      console.log(`${chalk.cyan('Signed off-chain order using EIP-712')}. Signature: ${chalk.blue(signature)}, Signing Scheme: ${chalk.blue(signingScheme)}`)

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
      console.log(chalk.cyan('\nUnderstood! Not sending the order. Have a nice day 👋'))
      exit(100)
    }    
  } else if (account.accountType === 'SAFE_WITH_EOA_PROPOSER') {
    assert(signer)
    const ethAdapter = new EthersAdapter({
      ethers,
      signer
    })

    // Instantiate API and 
    const safeApi = new SafeServiceClient({ txServiceUrl: getGnosisSafeServiceUrl(chainId), ethAdapter })
    
    // Instantiate the safe
    const safe = await Safe.create({ ethAdapter, safeAddress: fromAccount })
    
    // Print safe info
    const { nonce, owners, threshold } = await safeApi.getSafeInfo(fromAccount)
    console.log(`\n${chalk.cyan('Using safe:')}`)
    console.log(`    ${chalk.bold('Address')}: ${chalk.blue(fromAccount)}`)
    console.log(`    ${chalk.bold('Theshold:')} ${chalk.blue(threshold)} out of ${chalk.blue(owners.length)}`)
    console.log(`    ${chalk.bold('Owners:')} ${chalk.blue(owners.join(', '))}\n`)
    

    const postOrder = await confirm(`${chalk.cyan('Are you sure you want to post this order?')}`)
    if (postOrder) {
      // Post pre-sign order
      orderId = await cowSdk.cowApi.sendOrder({
        order: {
          ...rawOrder,
          signature: fromAccount, // TODO: I believe the signature is not required for pre-sign any more, but the SDK hasn't been updated
          signingScheme: SigningScheme.PRESIGN
        },
        owner: safeAddress as string
      })
      printExplorer(orderId, fromAccount, chainId)

      // Get Pre-sign order data
      const settlementAddress = settlementAddresses[chainId].address
      const settlement = Settlement__factory.connect(settlementAddress, signerOrProvider)
      dataBundle.push({
        description: 'Pre-sign order',
        txRequest: {
          to: settlementAddress,
          value: '0',
          data: settlement.interface.encodeFunctionData('setPreSignature', [orderId, true])
        }
      })

      // Print all the bundled transactions
      const txTotal = dataBundle.length    
      if (txTotal > 0) {
        console.log(`\n\n${chalk.cyan(`${chalk.red(txTotal)} Bundling Transactions`)}: Using Gnosis Safe\n`)
        let txNumber = 1
        for (const { txRequest, description } of dataBundle) {
          const { to, data } = txRequest
          console.log(`    [${txNumber}/${txTotal}] ${chalk.blue(description)}`)
          console.log(`          ${chalk.bold('To')}: ${to}`)
          console.log(`          ${chalk.bold('Tx Data')}: ${data}`)
          txNumber++
        }
      }

      // Create bundle transaction
      const safeTx = await safe.createTransaction(dataBundle.map(tx => tx.txRequest))
      await safe.signTransaction(safeTx)
      
      const safeTxHash = await safe.getTransactionHash(safeTx)
      // safeTx.addSignature()

      // Send transaction to safe service API
      const senderSignature = safeTx.encodedSignatures()
      const safeTxProposal = {
        safeAddress: fromAccount,
        safeTransactionData: safeTx.data,
        safeTxHash: safeTxHash,
        senderAddress: signer.address,
        senderSignature
      }
      const uiUrl = `https://gnosis-safe.io/app/${getSafeNetworkShortname(chainId)}:${fromAccount}/transactions/queue`
      console.log(`${chalk.cyan('\nPropose Bundled Transaction')}: In UI (${uiUrl})\n${JSON.stringify(safeTxProposal, null, 2)}`)
      await safeApi.proposeTransaction(safeTxProposal)
      console.log(`${chalk.cyan('🎉 Safe transaction has been created')}: See ${uiUrl}\n`)

      if (threshold === 1) {
        const executeTransaction = await confirm(`${chalk.cyan('Would you also like to execute the transaction?')} This step is not stricltly required. Anyone can execute now the transaction using the UI`)
        if (executeTransaction) {
          const safeTxResult = await safe.executeTransaction(safeTx)
          console.log(`${chalk.cyan('🎉 Safe transaction has been executed')}:\n${JSON.stringify(safeTxResult, null, 2)}`)
        } else {
          console.log(`${chalk.cyan('OK remember someone will need to execute before the order expires')}`)
        }
      } else {
        console.log(`${chalk.cyan(`Order created, but more signatures are required`)}: The order will need to be signed by other ${chalk.blue(threshold - 1)} signer(s)`)
      }
    } else {
      console.log(chalk.cyan('\nUnderstood! Not sending the order. Have a nice day 👋'))
      exit(100)
    }
  } else {
    throw new Error('Not implemented')
  }
  
  printExplorer(orderId, fromAccount, chainId)
  

  exit(0)
}

run().catch(error => {
  console.error(error)
  console.log(`\n${chalk.cyan('There was some errors')}. Exiting now! 👋`)
  exit(200)
})