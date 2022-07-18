import { CowSdk } from '@cowprotocol/cow-sdk'

const chainId = 4 // Rinkeby
const cowSdk = new CowSdk(chainId)

async function run() {
  const trader = '0x68ac5adfd66afa7bf79964cbb6defd91659dc54e'
  const trades = await cowSdk.cowApi.getOrders({
    owner: trader,
    limit: 5,
    offset: 0,
  })

  console.log(`Trades for ${trader}: ${trades.map(t => t.uid).join(', ')}`)
}

run().catch(console.error)