import { strict as assert } from 'node:assert'
import * as fs from 'fs/promises'
import * as readline from 'readline'
const chalk = require('chalk')
import { Wallet, ethers } from "ethers"

import { AccoutType, OrderParams, ChainId } from './types'
import { SUPPORTED_CHAIN_IDS } from './constants'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
export const ask = (query: string) => new Promise((resolve) => rl.question(query, resolve));
export const confirm = async (query: string): Promise<boolean> => {
  const response = await ask(`${query} ${chalk.italic('(y/n)')}: `)
  if (response === 'y' || response === 'Y') return true
  else if (response === 'n' || response === 'N') return false
  else {
    console.log(`${chalk.red(`Invalid response`)}: Please reply with a ${chalk.bold('Y')} or a ${chalk.bold('N')}`)
    return await confirm(query)
  }
}

export function getProvider(chainId: ChainId): ethers.providers.Provider {
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

export function getSigner(accoutType: AccoutType, provider: ethers.providers.Provider): Wallet | undefined {
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

export function getChainId(chainIdParam: number): ChainId {
  assert(SUPPORTED_CHAIN_IDS.includes(chainIdParam) , 'chainId must be one supported chainId. Supported: ' + SUPPORTED_CHAIN_IDS.join(', '))

  return chainIdParam as ChainId
}

export function getChainIdFromEnv(): ChainId {
  const chainIdEnv = process.env.CHAIN_ID
  assert(chainIdEnv, 'CHAIN_ID environmentis required')
  const chainId = parseInt(chainIdEnv)
  assert(chainIdEnv && SUPPORTED_CHAIN_IDS.includes(chainId) , 'CHAIN_ID must be one supported chainId. Supported: ' + SUPPORTED_CHAIN_IDS.join(', '))

  return chainId as ChainId
}


export async function getOrder(orderFilePath: string): Promise<OrderParams> {
  const content = await fs.readFile(orderFilePath)
  return JSON.parse(content.toString()) as OrderParams
}

export function getExplorerUrl(chainId: ChainId) {
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

export function getCowExplorerUrl(chainId: ChainId) {
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

export function getGnosisSafeServiceUrl(chainId: ChainId) {
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

export function getSafeNetworkShortname(chainId: ChainId) {
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