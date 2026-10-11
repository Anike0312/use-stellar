import React from "react"
import { act, renderHook } from "@testing-library/react"
import { StellarProvider } from "../context/StellarProvider"
import { useWallet } from "./useWallet"
import { registerWalletAdapter } from "../wallets"
import type { WalletAdapter } from "../wallets"

const ADDRESS = "GDWT6V543ZVXYNECWWUZ34ZHLJJ6OHGQXVYXJWD6WP7NOF65BT7GSUU5"
const PASSPHRASE = "Test SDF Network ; September 2015"

const adapter: WalletAdapter = {
  metadata: { type: "identity-test", name: "Identity Test", supported: true },
  isAvailable: async () => true,
  connect: jest.fn(async network => ({
    address: ADDRESS,
    wallet: "identity-test",
    network,
    networkPassphrase: PASSPHRASE,
  })),
  getNetworkDetails: async network => ({ network, networkPassphrase: PASSPHRASE }),
  signTransaction: async xdr => xdr,
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <StellarProvider network="testnet">{children}</StellarProvider>
}

describe("useWallet callback identity", () => {
  beforeAll(() => {
    registerWalletAdapter(adapter, { override: true })
  })

  it("keeps `connect` stable across wallet state updates", async () => {
    // An app that connects from an effect — `useEffect(() => { connect() },
    // [connect])` — would loop, prompting the wallet over and over, if
    // connecting changed `connect`'s identity.
    const { result } = renderHook(() => useWallet(), { wrapper })
    const before = result.current.connect

    await act(async () => {
      await result.current.connect("identity-test")
    })

    expect(result.current.connected).toBe(true)
    expect(result.current.connect).toBe(before)
  })
})
