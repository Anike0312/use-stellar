import { useCallback, useEffect, useRef, useState } from "react"
import type { QueryStore } from "./store"
import { serializeKey } from "./keys"
import {
  createQueryObserver,
  peekQuerySnapshot,
  type QueryObserver,
  type QueryObserverSnapshot,
} from "./observer"

/**
 * Options for `useQuery`.
 */
export interface UseQueryOptions<T> {
  /** The query key that identifies this request in the store. */
  queryKey: readonly unknown[]
  /** The async function that performs the actual network request. */
  queryFn: () => Promise<T>
  /** The store instance from the StellarProvider context. */
  store: QueryStore
  /**
   * How long (ms) data is considered fresh. Overrides the provider default.
   * Set to 0 to always re-fetch on mount.
   */
  staleTime?: number
  /**
   * Set to false to skip the fetch entirely (like `enabled: false` in TanStack
   * Query). The hook returns the current store snapshot but never fetches.
   */
  enabled?: boolean
  /**
   * Maximum number of automatic retries after a retriable failure (429, 5xx,
   * network errors). Defaults to 3. Set to 0 to disable automatic retries.
   *
   * When a 429 is received, the `Retry-After` response header is honoured
   * exactly. Other retriable errors use exponential back-off with full jitter.
   */
  maxRetries?: number
}

/**
 * Return shape mirroring what every existing hook already exposes, so the
 * cache is truly an implementation detail.
 */
export interface UseQueryResult<T> {
  data: T | null
  loading: boolean
  error: unknown
  /** Imperatively trigger a fresh fetch, bypassing staleTime. */
  refetch: () => void
  /** Epoch ms of the most recent successful fetch, or null. */
  updatedAt: number | null
  /**
   * A ref whose `.current` value is the epoch ms until which this query is
   * rate-limited (from the last 429 `Retry-After` header), or null when not
   * rate-limited. Exposed as a ref so polling hooks can read it without
   * causing re-renders.
   */
  rateLimitedUntilRef: React.MutableRefObject<number | null>
}

/**
 * The core caching primitive consumed by every read hook.
 *
 * A thin React adapter over the framework-neutral {@link createQueryObserver}:
 * React's only responsibility here is projecting the observer's snapshot into
 * component state so the reconciler knows when to re-render. All
 * orchestration — in-flight dedup, staleTime freshness, forced refetch, and
 * store writes — lives in the observer.
 */
export function useQuery<T>({
  queryKey,
  queryFn,
  store,
  staleTime,
  enabled = true,
  maxRetries = 3,
}: UseQueryOptions<T>): UseQueryResult<T> {
  const keyStr = serializeKey(queryKey)

  // The latest render's options, read by the effects below without making
  // them re-run for a new `queryFn` identity.
  const optionsRef = useRef({ queryKey, queryFn, staleTime, enabled, maxRetries })
  optionsRef.current = { queryKey, queryFn, staleTime, enabled, maxRetries }

  const observerRef = useRef<QueryObserver<T> | null>(null)

  // Render stays pure: the observer subscribes to the store and starts a
  // request as soon as it is constructed, so it is created in an effect, not
  // here. Until then, report what it is about to report.
  const [snapshot, setSnapshot] = useState<QueryObserverSnapshot<T>>(() =>
    peekQuerySnapshot<T>({ queryKey, queryFn, store, staleTime, enabled, maxRetries })
  )

  // rateLimitedUntilRef mirrors the observer's rate-limit window. Stored as a
  // ref (not state) so polling hooks can read it imperatively without
  // triggering re-renders and without act() issues in tests.
  const rateLimitedUntilRef = useRef<number | null>(null)

  // The observer lives exactly as long as this effect: created and subscribed
  // on mount, destroyed on unmount. A destroyed observer is never reused, so
  // StrictMode's mount → unmount → mount gets a fresh one the second time
  // (which joins the first one's in-flight request through the store).
  useEffect(() => {
    const observer = createQueryObserver<T>({ ...optionsRef.current, store })
    observerRef.current = observer

    const sync = (next: QueryObserverSnapshot<T>) => {
      setSnapshot(next)
      rateLimitedUntilRef.current = observer.getRateLimitedUntil()
    }
    const unsubscribe = observer.subscribe(sync)
    sync(observer.getSnapshot())

    return () => {
      unsubscribe()
      observer.destroy()
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [store])

  // Hand the observer every render's options, so it always calls the current
  // `queryFn` (which may close over values that are not part of the key) with
  // the current `staleTime` / `maxRetries`. Key and enabled changes are
  // applied here too — atomically, via the observer's own setOptions.
  useEffect(() => {
    observerRef.current?.setOptions(optionsRef.current)
  })

  // A key or enabled switch may not produce a store notification (fresh cached
  // data, or disabled), so project the observer's snapshot explicitly.
  useEffect(() => {
    const observer = observerRef.current
    if (!observer) return
    setSnapshot(observer.getSnapshot())
    rateLimitedUntilRef.current = observer.getRateLimitedUntil()
  }, [keyStr, store, enabled])

  const refetch = useCallback(() => {
    void observerRef.current?.fetch({ force: true })
  }, [])

  return {
    data: snapshot.data,
    loading: snapshot.loading,
    error: snapshot.error,
    updatedAt: snapshot.updatedAt,
    rateLimitedUntilRef,
    refetch,
  }
}
