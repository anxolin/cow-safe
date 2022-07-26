import { MetaTransactionData } from "@gnosis.pm/safe-core-sdk-types"

export type ChainId = 1 | 4 | 5 | 100

export type AccoutType = 'EOA' | 'SAFE' | 'SAFE_WITH_EOA_PROPOSER'
export interface AccountParams {
  accountType: AccoutType
  safeAddress?: string
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

export type TxRequest = Pick<MetaTransactionData, 'to' | 'value' | 'data'>

export interface OnchainOperation {
  description: string
  txRequest: TxRequest
}