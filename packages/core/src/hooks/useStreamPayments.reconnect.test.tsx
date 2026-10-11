import React from "react"
import { renderHook, act } from "@testing-library/react"
import { StellarProvider } from "../context/StellarProvider"
import { useStreamPayments } from "./useStreamPayments"

jest.mock("../utils", () => ({
  ...jest.requireActual("../utils"),
  getHorizonServer: jest.fn(),
}))

import { getHorizonServer } from "../utils"

const mockGetServer = getHorizonServer as jest.Mock
const ADDR = "GDWT6V543ZVXYNECWWUZ34ZHLJJ6OHGQXVYXJWD6WP7NOF65BT7GSUU5"
const OTHER = "GDX76CSVSJMYE7PMG2JI7CMERG4CK3UNKX4G6SXZJCY2NLJEWXA2XRSS"

interface StreamOptions {
  onmessage?: (record: unknown) => void
  onerror?: (event: unknown) => void
}

/** Records every stream the hook opens, with its own handlers and close spy. */
function createStreamingBuilder() {
  const streams: { options: StreamOptions; close: jest.Mock }[] = []
  const builder: { forAccount: jest.Mock; cursor: jest.Mock; stream: jest.Mock } = {
    forAccount: jest.fn(() => builder),
    cursor: jest.fn(() => builder),
    stream: jest.fn((options: StreamOptions = {}) => {
      const close = jest.fn()
      streams.push({ options, close })
      return close
    }),
  }
  return { builder, streams }
}

function payment(token: string) {
  return {
    id: token,
    paging_token: token,
    transaction_hash: `hash-${token}`,
    created_at: "2024-01-01T00:00:00Z",
    type: "payment",
    from: "GOTHER",
    to: ADDR,
    amount: "10.0000000",
    asset_type: "native",
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <StellarProvider network="testnet">{children}</StellarProvider>
}

beforeEach(() => {
  jest.useFakeTimers()
  mockGetServer.mockReset()
})

afterEach(() => {
  jest.useRealTimers()
})

describe("useStreamPayments reconnect", () => {
  it("closes the failed stream before opening its replacement", () => {
    const { builder, streams } = createStreamingBuilder()
    mockGetServer.mockReturnValue({ payments: () => builder })

    const { result } = renderHook(() => useStreamPayments({ address: ADDR }), { wrapper })
    expect(streams).toHaveLength(1)

    act(() => streams[0].options.onerror?.(new Event("error")))
    // The SDK's stream keeps retrying on its own unless it is closed.
    expect(streams[0].close).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(streams).toHaveLength(2)

    // A straggler from the replaced stream is ignored: one payment, one row.
    act(() => {
      streams[0].options.onmessage?.(payment("1"))
      streams[1].options.onmessage?.(payment("1"))
    })
    expect(result.current.payments).toHaveLength(1)
  })

  it("leaves nothing open after unmount, even mid-reconnect", () => {
    const { builder, streams } = createStreamingBuilder()
    mockGetServer.mockReturnValue({ payments: () => builder })

    const { unmount } = renderHook(() => useStreamPayments({ address: ADDR }), { wrapper })
    act(() => streams[0].options.onerror?.(new Event("error")))

    unmount()
    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    expect(streams).toHaveLength(1)
    expect(streams[0].close).toHaveBeenCalled()
  })

  it("drops the previous account's payments and cursor when the address changes", () => {
    const { builder, streams } = createStreamingBuilder()
    mockGetServer.mockReturnValue({ payments: () => builder })

    const { result, rerender } = renderHook(
      ({ address }: { address: string }) => useStreamPayments({ address }),
      { wrapper, initialProps: { address: ADDR } }
    )
    act(() => streams[0].options.onmessage?.(payment("42")))
    expect(result.current.payments).toHaveLength(1)

    rerender({ address: OTHER })

    expect(result.current.payments).toHaveLength(0)
    expect(result.current.cursor).toBeNull()
    expect(builder.forAccount).toHaveBeenLastCalledWith(OTHER)
    expect(builder.cursor).toHaveBeenLastCalledWith("now")
  })
})
