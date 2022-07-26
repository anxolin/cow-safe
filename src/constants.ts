import { BigNumber } from "ethers"
import { GPv2Settlement } from '@cowprotocol/contracts/networks.json'

export const MAX_U32 = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
export const TEN_THOUSAND = BigNumber.from('10000')

export const APP_DATA = process.env.APP_DATA || '0x0000000000000000000000000000000000000000000000000000000000000000'
export const DEADLINE_OFFSET = 30 * 60 * 1000 // 30min
export const DEFAULT_SLIPPAGE_BIPS = 100

export const NUMBER_CONFIRMATIONS_WAIT = 1
export const SUPPORTED_CHAIN_IDS = Object.keys(GPv2Settlement).map(chainIdString => parseInt(chainIdString))