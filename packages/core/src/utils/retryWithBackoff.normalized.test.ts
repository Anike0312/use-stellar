/**
 * The query fetchers in `queries/*` throw a normalized `StellarError`, not the
 * raw Horizon error. The retry layer sits above them, so it has to recognise a
 * 429 through that wrapper — otherwise `maxRetries` is silently a no-op.
 */

import { getErrorStatus, getRetryAfterMs, isRetriable, retryWithBackoff } from "./retryWithBackoff"
import { toStellarError } from "../errors"

function horizonError(status: number, retryAfter?: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: {
      status,
      headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
      data: { type: "https://stellar.org/horizon-errors/rate_limit_exceeded", status },
    },
  })
}

describe("retryWithBackoff with normalized errors", () => {
  let setTimeoutSpy: jest.SpyInstance

  beforeEach(() => {
    // Make sleeps instant.
    setTimeoutSpy = jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      fn()
      return 0
    }) as unknown as typeof setTimeout)
  })

  afterEach(() => {
    setTimeoutSpy.mockRestore()
  })

  it("reads status and Retry-After through a StellarError's raw error", () => {
    const normalized = toStellarError(horizonError(429, 7))

    expect(normalized?.code).toBe("RATE_LIMITED")
    expect(getErrorStatus(normalized)).toBe(429)
    expect(getRetryAfterMs(normalized)).toBe(7_000)
    expect(isRetriable(normalized)).toBe(true)
  })

  it("retries a normalized 429", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(toStellarError(horizonError(429, 1)))
      .mockResolvedValue("ok")

    expect(await retryWithBackoff(fn, { maxRetries: 3 })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("still does not retry a normalized 404", async () => {
    const normalized = toStellarError(horizonError(404))
    const fn = jest.fn().mockRejectedValue(normalized)

    await expect(retryWithBackoff(fn, { maxRetries: 3 })).rejects.toBe(normalized)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
