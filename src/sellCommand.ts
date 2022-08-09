import 'dotenv/config'
import { strict as assert } from 'node:assert'
import { exit } from 'process'
const chalk = require('chalk')
import { BigNumber, ethers } from "ethers"

// Gnosis Safe dependencies
import EthersAdapter from '@gnosis.pm/safe-ethers-lib'
import Safe from '@gnosis.pm/safe-core-sdk'
import SafeServiceClient, { SafeInfoResponse } from '@gnosis.pm/safe-service-client'

// CoW Protocol dependencies
import { CowSdk, OrderKind } from '@cowprotocol/cow-sdk'
import { OrderBalance, SigningScheme, QuoteQuery } from '@cowprotocol/contracts';
import { GPv2Settlement as settlementAddresses, GPv2VaultRelayer as vaultAddresses } from '@cowprotocol/contracts/networks.json'

// Types and utils
import { ChainId, OnchainOperation, OrderParams, RawOrder } from './types'
import { Settlement__factory, Erc20__factory } from './abi/types';
import {getCowExplorerUrl, getChainIdFromEnv, getOrder, getProvider, getSigner, getExplorerUrl, getGnosisSafeServiceUrl, getSafeNetworkShortname, confirm } from './utils'
import { DEFAULT_SLIPPAGE_BIPS, APP_DATA, DEADLINE_OFFSET, TEN_THOUSAND, MAX_U32, NUMBER_CONFIRMATIONS_WAIT } from './constants'
import { SafeTransaction } from '@gnosis.pm/safe-core-sdk-types'

function printExplorer(orderId: string, fromAccount: string, chainId: ChainId) {
  // Show link to explorer
  const cowExplorerUrl = getCowExplorerUrl(chainId)
  console.log(`\n🚀 ${chalk.cyan('The order has been submitted')}. See ${chalk.blue(`${cowExplorerUrl}/orders/${orderId}`)}
              See ${chalk.underline('full history')} in ${chalk.blue(`${cowExplorerUrl}/address/${fromAccount}`)}`)
}

function getSdkInstance(orderDefinition: OrderParams) {
  const { chainId=getChainIdFromEnv(), account } = orderDefinition  

  const provider = getProvider(chainId)
  const signer = getSigner(account.accountType, provider)
  const signingAccount = signer?.address
  
  const cowSdk = new CowSdk(chainId, { signer, appDataHash: APP_DATA })
  console.log(`${chalk.red('CoW SDK')} ${chalk.cyan('initialized')}. Signing Account: ${chalk.blue(signingAccount ? signingAccount : 'Undefined')}, Network: ${chalk.blue(chainId)}`)

  return { cowSdk, provider, signingAccount, signer, chainId }
}

function getTradingAccounts(params: { orderDefinition: OrderParams, signingAccount?: string }) {
  const { orderDefinition, signingAccount } = params
  const { account, order } = orderDefinition
  const { accountType, safeAddress } = account
  const { receiver: receiverParam } = order

  // Decide who is the fromAccount and receiver
  let fromAccount: string, receiver: string
  if (accountType === 'EOA') {
    // In EOA is the signing account
    assert(signingAccount, `The signer address is missing`)
    fromAccount = signingAccount
    receiver = receiverParam || signingAccount
  } else {
    // Otherwise is the safe address
    assert(safeAddress, `The safeAddress is a required parameter for account type: ${accountType}`)
    fromAccount = safeAddress
    receiver = receiverParam || safeAddress
  }

  return { fromAccount, receiver }
}

function getQuoteOrder(params: { orderDefinition: OrderParams, fromAccount: string, receiver: string }): QuoteQuery {
  const { orderDefinition, fromAccount, receiver } = params
  const { order } = orderDefinition
  
  const {
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmountBeforeFee,
    partiallyFillable = false,    
    appData = process.env.APP_DATA || APP_DATA
  } = order  

  // Prepare quote order
  return {
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
    receiver,

    // Deadline
    validTo: Math.ceil((Date.now() + DEADLINE_OFFSET) / 1000),

    // Metadata
    appData
  }
}

function getOrderFilePath(): string {
  const myArgs = process.argv.slice(2)
  if (myArgs.length === 0) {
    console.error(`${chalk.cyan('Missing argument. Path to the order definition JSON file')}. i.e. yarn sell examples/eoa-rinkeby-market-order.json`)
    exit(99)
  }
  return myArgs[0]
}



async function getAppoveOperation(params: { fromAccount: string, sellAmount: string, chainId: ChainId, orderDefinition: OrderParams, signerOrProvider: ethers.Wallet | ethers.providers.Provider }): Promise<OnchainOperation| undefined> {
  const { fromAccount, sellAmount, chainId, orderDefinition, signerOrProvider } = params

  // Validate if enough balance
  const { sellToken: sellTokenAddress, sellAmountBeforeFee } = orderDefinition.order
  const sellToken = Erc20__factory.connect(sellTokenAddress, signerOrProvider)  
  const balance = await sellToken.balanceOf(fromAccount)
  if (balance.lt(sellAmountBeforeFee)) {
    throw new Error(`User doesn't have enough balance for token ${sellTokenAddress}. Required ${sellAmountBeforeFee}, balance ${balance}`)
  }
  
  // Check allowance (decide if approve sellToken is required)
  const vaultAddress = vaultAddresses[chainId].address
  const allowance = await sellToken.allowance(fromAccount, vaultAddress)
  if (allowance.gte(sellAmount)) {
    // Enough allowance
    return undefined
  }
  
  // Get the approve data
  return {
    description: 'Approve sell token',
    txRequest: {
      to: sellTokenAddress,
      value: '0',
      data: sellToken.interface.encodeFunctionData('approve', [vaultAddress, MAX_U32])
    }
  }
}

async function executePreInteractions(params: { txs: OnchainOperation[], signingAccount?: string, signer: ethers.Wallet, chainId: ChainId }) {
  const { txs, signingAccount, signer, chainId } = params

  // Execute all transactions, one by one
  const txsTotal = txs.length
  if (txsTotal > 0) {
    console.log(`\n\n${chalk.cyan(`${chalk.red(txsTotal)} transactions need to be executed`)} before the order can be posted:\n`)
    let txNumber = 1
    for (const { txRequest, description } of txs) {
      const { to, data } = txRequest
      console.log(`    [${txNumber}/${txsTotal}] ${chalk.cyan('Are you sure you want to')} ${chalk.blue(description)}?}`)
      console.log(`          ${chalk.bold('To')}: ${to}`)
      console.log(`          ${chalk.bold('Tx Data')}: ${data}`)
      txNumber++
      const sendTransaction = await confirm(`    Approve transaction?`)
      if (!sendTransaction) {                
        console.log(chalk.cyan('\nUnderstood! Not sending the transaction. Have a nice day 👋'))
        exit(100)
      }

      const txResponse = await signer.sendTransaction({
        from: signingAccount,
        to,
        data
      })
      console.log(`    Sent transaction for ${chalk.blue(description)}. Review in block explorer: ${chalk.blue(getExplorerUrl(chainId) + '/' + txResponse.hash)}`)
      await txResponse.wait()
      console.log(`    🎉 ${chalk.cyan('Transactions was mined!')} waiting for ${chalk.red(NUMBER_CONFIRMATIONS_WAIT)} confirmations before continuing`)
      await txResponse.wait(NUMBER_CONFIRMATIONS_WAIT)
    }
  }
}


async function signAndPostOrderEip712(params: { signingAccount: string, rawOrder: RawOrder, cowSdk: CowSdk<ChainId> }) {
  const {signingAccount, rawOrder, cowSdk } = params
  const postOrder = await confirm(`${chalk.cyan('Are you sure you want to post this order?')}`)
  if (!postOrder) {
    console.log(chalk.cyan('\nUnderstood! Not sending the order. Have a nice day 👋'))
    exit(100)
  }    

  // Sign the order
  
  const { signature, signingScheme } = await cowSdk.signOrder(rawOrder)
  assert(signature, 'signOrder must return the signature')

  console.log(`${chalk.cyan('Signed off-chain order using EIP-712')}. Signature: ${chalk.blue(signature)}, Signing Scheme: ${chalk.blue(signingScheme)}`)

  // Post order
  const orderId = await cowSdk.cowApi.sendOrder({
    order: {
      ...rawOrder,
      signature,
      signingScheme
    },
    owner: signingAccount as string
  })

  return orderId
}


async function getSafe(params: { fromAccount: string, signer: ethers.Wallet, chainId: ChainId }) {
  const { fromAccount, signer, chainId } = params
  const ethAdapter = new EthersAdapter({
    ethers,
    signer
  })    

  // Instantiate API and 
  const safeApi = new SafeServiceClient({ txServiceUrl: getGnosisSafeServiceUrl(chainId), ethAdapter })
  
  // Instantiate the safe`
  const safe = await Safe.create({ ethAdapter, safeAddress: fromAccount })

  return { safe, safeApi }
}

function printSafeInfo(safeInfo: SafeInfoResponse) {
  const { nonce, owners, threshold, address } = safeInfo

  console.log(`\n${chalk.cyan('Using safe:')}`)
  console.log(`    ${chalk.bold('Address')}: ${chalk.blue(address)}`)
  console.log(`    ${chalk.bold('Theshold:')} ${chalk.blue(threshold)} out of ${chalk.blue(owners.length)}`)
  console.log(`    ${chalk.bold('Owners:')} ${chalk.blue(owners.join(', '))}\n`)
  console.log(`    ${chalk.bold('Current Nonce:')} ${chalk.blue(nonce)}\n`)
}

async function postOrderPresign(param: { signingAccount: string, rawOrder: RawOrder, txs: OnchainOperation[], safeInfo: SafeInfoResponse, safe: Safe, cowSdk: CowSdk<ChainId>, safeApi: SafeServiceClient, chainId: ChainId, signerOrProvider: ethers.Wallet | ethers.providers.Provider }): Promise<string> {
  const { signingAccount, rawOrder, txs, safeInfo, safe, cowSdk, safeApi, chainId, signerOrProvider } = param
  const fromAccount = rawOrder.from

  const postOrder = await confirm(`${chalk.cyan('Are you sure you want to post this order?')}`)
  if (!postOrder) {
    console.log(chalk.cyan('\nUnderstood! Not sending the order. Have a nice day 👋'))
    exit(100)
  }

   // Post pre-sign order
   const orderId = await cowSdk.cowApi.sendOrder({
    order: {
      ...rawOrder,
      signature: fromAccount, // TODO: I believe the signature is not required for pre-sign any more, but the SDK hasn't been updated
      signingScheme: SigningScheme.PRESIGN
    },
    owner: fromAccount
  })
  printExplorer(orderId, fromAccount, chainId)

  // Get Pre-sign order data
  const presignOperations = await getPresignOperation({ orderId, chainId, signerOrProvider })
  txs.push(presignOperations)
  
  // Print all the bundled transactions
  printBundledTransactions(txs)  

  // Send transaction to safe service API
  const safeTx = await postSafeProposal({ signingAccount, safeInfo, txs, safe, safeApi, chainId })

  // Execute Safe transaction
  executeSafeTransaction({ safeTx, safeInfo, safe, chainId })

  return orderId
}


function getPresignOperation(params: { orderId: string, chainId: ChainId, signerOrProvider: ethers.Wallet | ethers.providers.Provider }): OnchainOperation {
  const { orderId, chainId, signerOrProvider} = params

  const settlementAddress = settlementAddresses[chainId].address
  const settlement = Settlement__factory.connect(settlementAddress, signerOrProvider)
  
  return {
    description: 'Pre-sign order',
    txRequest: {
      to: settlementAddress,
      value: '0',
      data: settlement.interface.encodeFunctionData('setPreSignature', [orderId, true])
    }
  }
}

function printBundledTransactions(txs: OnchainOperation[]) {
  const txTotal = txs.length    
  if (txTotal > 0) {
    console.log(`\n\n${chalk.cyan(`${chalk.red(txTotal)} Bundling Transactions`)}: Using Gnosis Safe\n`)
    let txNumber = 1
    for (const { txRequest, description } of txs) {
      const { to, data } = txRequest
      console.log(`    [${txNumber}/${txTotal}] ${chalk.blue(description)}`)
      console.log(`          ${chalk.bold('To')}: ${to}`)
      console.log(`          ${chalk.bold('Tx Data')}: ${data}`)
      txNumber++
    }
  }
}

async function postSafeProposal(params: { signingAccount: string, safeInfo: SafeInfoResponse, txs: OnchainOperation[], safe: Safe, safeApi: SafeServiceClient, chainId: ChainId }): Promise<SafeTransaction> {
  const { signingAccount, safeInfo, txs, safe, safeApi, chainId } = params
  const fromAccount = safeInfo.address

  // Create bundle transaction
  const safeTx = await safe.createTransaction(txs.map(tx => tx.txRequest))  
  await safe.signTransaction(safeTx)
  const safeTxHash = await safe.getTransactionHash(safeTx)

  // Prepare proposal
  const senderSignature = safeTx.encodedSignatures()
  const safeTxProposal = {
    safeAddress: fromAccount,
    safeTransactionData: safeTx.data,
    safeTxHash: safeTxHash,
    senderAddress: signingAccount,
    senderSignature
  }

  // Propose transaction to Safe UI
  const uiUrl = `https://gnosis-safe.io/app/${getSafeNetworkShortname(chainId)}:${fromAccount}/transactions/queue`
  console.log(`${chalk.cyan('\nPropose Bundled Transaction')}: In UI (${uiUrl})\n${JSON.stringify(safeTxProposal, null, 2)}`)
  await safeApi.proposeTransaction(safeTxProposal)
  console.log(`${chalk.cyan('🎉 Safe transaction has been created')}: See ${uiUrl}\n`)

  return safeTx
}



async function executeSafeTransaction(params: { safeTx: SafeTransaction, safeInfo: SafeInfoResponse, safe: Safe, chainId: ChainId }) {
  const { safeTx, safeInfo, safe, chainId } = params
  const { threshold } = safeInfo
  if (threshold !== 1) {
    console.log(`${chalk.cyan(`Order created, but more signatures are required`)}: The order will need to be signed by other ${chalk.blue(threshold - 1)} signer(s)`)
    return
  }

  // If we have enough signatures, we offer to also execute
  const executeTransaction = await confirm(`${chalk.cyan('Would you also like to execute the transaction?')} This step is not stricltly required. Anyone can execute now the transaction using the UI`)

  if (!executeTransaction) {    
    console.log(`${chalk.cyan('OK remember someone will need to execute before the order expires')}`)
    return
  }

  // Execute safe transaction
  const safeTxResult = await safe.executeTransaction(safeTx)
  console.log(`${chalk.cyan('🎉 Safe transaction has been sent')}: Review in block explorer: ${chalk.blue(getExplorerUrl(chainId) + '/' + safeTxResult.hash)}`)
}


async function run() {  
  // Get order definition from file
  const orderFilePath = getOrderFilePath()
  const orderDefinition = await getOrder(orderFilePath)

  // Instantiate SDK
  const { cowSdk, provider, signingAccount, signer, chainId } = getSdkInstance(orderDefinition)
  const { account } = orderDefinition
  const signerOrProvider = signer || provider

  // Get quote query: info required to get a price §
  const { fromAccount, receiver } = getTradingAccounts({ orderDefinition, signingAccount })
  const quoteOrder = getQuoteOrder({ orderDefinition, fromAccount, receiver })

  // Get quote
  console.log(`${chalk.cyan('Get quote for order')}:\n${JSON.stringify(quoteOrder, null, 2)}`)
  const quoteResponse = await cowSdk.cowApi.getQuote(quoteOrder) 
  const { sellAmount: sellAmountQuote, buyAmount: buyAmountQuote, feeAmount } = quoteResponse.quote
  console.log(`${chalk.cyan('Quote response')}: Receive at least ${chalk.blue(buyAmountQuote)} buy tokens. Fee = ${chalk.blue(feeAmount)}\n${JSON.stringify(quoteResponse, null, 2)} sell tokens.`)

  // Set your own price
  const { sellAmount, buyAmount } = getCustomPrice({ sellAmountQuote, buyAmountQuote, orderDefinition })

  // Prepare the RAW order
  const rawOrder: RawOrder = {
    ...quoteOrder,
    receiver,

    // Limit Price
    sellAmount,
    buyAmount,
    sellAmountBeforeFee: undefined,

    // Fee
    feeAmount,    
    priceQuality: "optimal"
  }
  delete rawOrder.sellAmountBeforeFee
  console.log(`${chalk.cyan('Raw order')}: \n${JSON.stringify(rawOrder, null, 2)}`)

  // We'll accumulate some transactions, either to bundle them (in a safe setup), or to execute them (in EOA)
  const txs: OnchainOperation[] = []
  let orderId

  // Add approval operation
  const approveOperation = await getAppoveOperation({ fromAccount, sellAmount, chainId, orderDefinition, signerOrProvider })
  if (approveOperation) {
    txs.push(approveOperation)
  }

  const { accountType } = account
  const isEip1271 = accountType === 'SAFE_WITH_EOA_EIP1271'
  const isPreSign = accountType === 'SAFE_WITH_EOA_PRESIGN'

  if (accountType === 'EOA') {    
    assert(signer && signingAccount)

    // Execute pre-interations before creating the order
    await executePreInteractions({ txs, signingAccount, signer, chainId })
    
    // Sign and Post order
    orderId = await signAndPostOrderEip712({ signingAccount, rawOrder, cowSdk })    
  } else if (isPreSign || isEip1271) {
    assert(signer && signingAccount)

    // Get safe SDK & Api
    const { safe, safeApi } = await getSafe({ fromAccount, chainId, signer })    
    
    // Print safe info
    const safeInfo = await safeApi.getSafeInfo(fromAccount)    
    printSafeInfo(safeInfo)

    let usePresign
    if (isEip1271) {
      if (txs.length > 0) {
        console.log(`${chalk.cyan(`You cannot trade gassless yet!`)}: You try to trade using EIP-1271, but you need to do some pre-interaction which requires an ethereum transaction (approve sell token or wrap ether). Therefore we will create this order as a bundle transaction which uses pre-sign`)
        usePresign = true
      } else {
        usePresign = false
      }
    } else if (isPreSign) {
      usePresign = true
    } else {
      throw new Error('Unsupported account type' + accountType)
    }

    if (usePresign) {
      // Post pre-sign order
      orderId = await postOrderPresign({ signingAccount, rawOrder, txs, cowSdk, safeInfo, safe, chainId, safeApi, signerOrProvider })    
    } else {
      // Use EIP-1271
      throw new Error('Not implemented EIP-1271')
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

function getCustomPrice(params: { sellAmountQuote: string; buyAmountQuote: string; orderDefinition: OrderParams }) {
  const { sellAmountQuote, buyAmountQuote, orderDefinition } = params
  const {
    slippageToleranceBips: slippageToleranceBips = DEFAULT_SLIPPAGE_BIPS,
  } = orderDefinition.order

  // Reduce the buyAmount by some slippageToleranceBips
  const buyAmountAfterSlippage = BigNumber
    .from(buyAmountQuote)
    .mul(TEN_THOUSAND.sub(BigNumber.from(slippageToleranceBips)))
    .div(TEN_THOUSAND)
  console.log(`${chalk.cyan(`Apply ${chalk.blue(slippageToleranceBips + ' BIPs')} to expected receive tokens`)}. Accepting ${chalk.blue(buyAmountAfterSlippage)}, expected ${chalk.blue(buyAmountQuote)}`)

  return {
    sellAmount: sellAmountQuote, // sellAmount already has the fees deducted
    buyAmount: buyAmountAfterSlippage.toString()
  }
}
