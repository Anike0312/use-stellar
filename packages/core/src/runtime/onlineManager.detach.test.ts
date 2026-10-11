import { OnlineManager } from "./onlineManager"

describe("OnlineManager without subscribers", () => {
  it("does not keep reporting offline after the last subscriber leaves", () => {
    const manager = new OnlineManager()
    let report: (online: boolean) => void = () => {}
    const cleanup = jest.fn()
    manager.setEventListener(setOnline => {
      report = setOnline
      return cleanup
    })

    const unsubscribe = manager.subscribe(() => {})
    report(false)
    expect(manager.isOnline()).toBe(false)

    // Every query unmounts while offline. The signal is detached, so the
    // reconnect that follows is never heard.
    unsubscribe()
    expect(cleanup).toHaveBeenCalledTimes(1)

    // With nothing listening the stored state is unverifiable; it must fall
    // back to the platform's answer (online, in a test environment) instead of
    // pausing every future query and write.
    expect(manager.isOnline()).toBe(true)
  })

  it("picks the state up again from the signal on the next subscription", () => {
    const manager = new OnlineManager()
    let report: (online: boolean) => void = () => {}
    manager.setEventListener(setOnline => {
      report = setOnline
    })

    manager.subscribe(() => {})()

    const listener = jest.fn()
    manager.subscribe(listener)
    report(false)

    expect(manager.isOnline()).toBe(false)
    expect(listener).toHaveBeenCalledWith(false)
  })
})
