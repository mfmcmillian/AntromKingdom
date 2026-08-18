import { executeTask } from '@dcl/sdk/ecs'
import { createEthereumProvider } from '@dcl/sdk/ethereum-provider'
import { getPlayer } from '@dcl/sdk/src/players'
import { BigNumber, ContractFactory, RequestManager, toChecksumAddress, toWei } from 'eth-connect'
import { MANA_ABI } from '../contracts/mana'

export const TIP_MANA_AMOUNT = 100
export const TIP_WALLET = '0xfe2d424af0df49bb3316cb2e9f574b0d09cf98ad'

const MANA_ETH = '0x0f5d2fb29fb7d3cfee444a200298f468908cc942'
const MANA_POLYGON = '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4'
const TRANSFER_GAS_FALLBACK = 100000

type ManaContract = {
  transfer: {
    (to: string, value: BigNumber, options: { from: string; gas?: number; gasPrice?: BigNumber }): Promise<unknown>
    estimateGas: (to: string, value: BigNumber, options: { from: string }) => Promise<number>
  }
  balanceOf: (owner: string) => Promise<BigNumber>
}

export type TipStatus = 'idle' | 'pending' | 'success' | 'error'

let status: TipStatus = 'idle'
let errorText = ''

export function getTipStatus(): TipStatus {
  return status
}

export function getTipError(): string {
  return errorText
}

export function startManaTip(onSuccess: () => void): void {
  if (status === 'pending') return
  const player = getPlayer()
  if (!player?.userId || player.isGuest) {
    status = 'error'
    errorText = 'Connect a wallet to tip 100 MANA.'
    return
  }

  status = 'pending'
  errorText = ''
  const from = player.userId

  executeTask(async () => {
    try {
      const provider = createEthereumProvider()
      const requestManager = new RequestManager(provider)
      const chainId = await readChainId(requestManager)
      const token = manaTokenForChain(chainId)
      if (!token) {
        status = 'error'
        errorText = 'Switch to Ethereum or Polygon to tip MANA.'
        return
      }

      const factory = new ContractFactory(requestManager, MANA_ABI)
      const contract = (await factory.at(token)) as unknown as ManaContract
      const amount = new BigNumber(toWei(String(TIP_MANA_AMOUNT), 'ether'))
      const recipient = toChecksumAddress(TIP_WALLET)

      const balance = new BigNumber(await contract.balanceOf(from))
      if (balance.lt(amount)) {
        status = 'error'
        errorText = 'Not enough MANA to tip 100.'
        return
      }

      const gasPrice = await requestManager.eth_gasPrice()
      let gas = TRANSFER_GAS_FALLBACK
      try {
        gas = await contract.transfer.estimateGas(recipient, amount, { from })
      } catch {
        // Explorer sometimes can't estimate; a standard ERC-20 transfer still fits this cap.
      }

      await contract.transfer(recipient, amount, { from, gas, gasPrice })
      status = 'success'
      errorText = ''
      onSuccess()
    } catch (error) {
      status = 'error'
      errorText = tipFailureMessage(error)
    }
  })
}

function manaTokenForChain(chainId: number): string | undefined {
  if (chainId === 1) return MANA_ETH
  if (chainId === 137) return MANA_POLYGON
  return undefined
}

async function readChainId(requestManager: RequestManager): Promise<number> {
  try {
    const hex = await requestManager.sendAsync({ method: 'eth_chainId', params: [] })
    const parsed = Number.parseInt(String(hex), 16)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch {
    // Fall through to net_version.
  }

  try {
    const version = await requestManager.net_version()
    const parsed = Number(version)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch {
    // Default to Ethereum mainnet; the transfer will fail if the wallet is elsewhere.
  }
  return 1
}

function tipFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/user rejected|denied|rejected/i.test(text)) return 'Tip cancelled.'
  if (/insufficient|balance/i.test(text)) return 'Not enough MANA to tip 100.'
  return 'Tip failed. Check your wallet and try again.'
}
