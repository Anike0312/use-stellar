import React from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryStore } from "./store"
import { useQuery } from "./useQuery"

const KEY = ["useQuery-test", "a"] as const

function strictWrapper({ children }: { children: React.ReactNode }) {
  return <React.StrictMode>{children}</React.StrictMode>
}

describe("useQuery", () => {
  it("resolves under StrictMode's mount → unmount → mount", async () => {
    const store = new QueryStore()
    const queryFn = jest.fn().mockResolvedValue("value")

    const { result } = renderHook(() => useQuery({ queryKey: KEY, queryFn, store }), {
      wrapper: strictWrapper,
    })

    await waitFor(() => expect(result.current.data).toBe("value"))
    expect(result.current.loading).toBe(false)
    // The remounted observer joins the first one's in-flight request.
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it("leaves no store subscriber behind after unmount", async () => {
    const store = new QueryStore()
    const queryFn = jest.fn().mockResolvedValue("value")

    const { result, unmount } = renderHook(() => useQuery({ queryKey: KEY, queryFn, store }), {
      wrapper: strictWrapper,
    })
    await waitFor(() => expect(result.current.data).toBe("value"))
    expect(store.getSnapshot(KEY)?.subscribers).toBe(1)

    unmount()
    expect(store.getSnapshot(KEY)?.subscribers).toBe(0)
  })

  it("does not fetch or subscribe during render", () => {
    const store = new QueryStore()
    const queryFn = jest.fn().mockResolvedValue("value")

    // Observed from inside the render itself, before any effect has run — which
    // is all a server render ever does.
    const duringFirstRender: { calls: number; hasEntry: boolean; loading: boolean }[] = []

    renderHook(() => {
      const result = useQuery({ queryKey: KEY, queryFn, store })
      if (duringFirstRender.length === 0) {
        duringFirstRender.push({
          calls: queryFn.mock.calls.length,
          hasEntry: store.getSnapshot(KEY) !== undefined,
          loading: result.loading,
        })
      }
      return result
    })

    // …and it already reads as loading, since the mount effect will fetch.
    expect(duringFirstRender[0]).toEqual({ calls: 0, hasEntry: false, loading: true })
  })

  it("reports loading on the first render and not when disabled", () => {
    const store = new QueryStore()
    const queryFn = jest.fn(() => new Promise<string>(() => {}))
    const seen: boolean[] = []

    renderHook(() => {
      const result = useQuery({ queryKey: KEY, queryFn, store })
      seen.push(result.loading)
      return result
    })
    expect(seen[0]).toBe(true)

    const disabled = renderHook(() =>
      useQuery({ queryKey: ["useQuery-test", "off"], queryFn, store, enabled: false })
    )
    expect(disabled.result.current.loading).toBe(false)
  })

  it("calls the latest queryFn when it changes without a key change", async () => {
    const store = new QueryStore()
    const first = jest.fn().mockResolvedValue("first")
    const second = jest.fn().mockResolvedValue("second")

    const { result, rerender } = renderHook(
      ({ queryFn }: { queryFn: () => Promise<string> }) =>
        useQuery({ queryKey: KEY, queryFn, store }),
      { initialProps: { queryFn: first } }
    )
    await waitFor(() => expect(result.current.data).toBe("first"))

    rerender({ queryFn: second })
    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.data).toBe("second"))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("shows the cached entry when the key switches to fresh data", async () => {
    const store = new QueryStore()
    store.setData(["useQuery-test", "b"], "cached-b")
    const queryFn = jest.fn().mockResolvedValue("a")

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useQuery({ queryKey: ["useQuery-test", id], queryFn, store }),
      { initialProps: { id: "a" } }
    )
    await waitFor(() => expect(result.current.data).toBe("a"))

    rerender({ id: "b" })

    await waitFor(() => expect(result.current.data).toBe("cached-b"))
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
