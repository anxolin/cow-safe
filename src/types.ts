import { UnsignedOrder } from "@cowprotocol/cow-sdk/dist/utils/sign"
import { MetaTransactionData } from "@gnosis.pm/safe-core-sdk-types"

export type ChainId = 1 | 4 | 5 | 100

export type AccoutType = 'EOA' | 'SAFE_WITH_EOA_PRESIGN' | 'SAFE_WITH_EOA_EIP1271'

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

export type RawOrder = UnsignedOrder & {
  from: string,
  priceQuality: 'optimal', // TODO: Review types in SDK, the API was returning an error if not if not priceQuality
  sellAmountBeforeFee: any
} 
