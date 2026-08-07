import { expect, test } from "bun:test"
import { PluginHost, type BuiltinPlugin } from "../src/plugins/host"

test("plugin failures roll back their resources and successful plugins dispose in reverse", async () => {
  const events: string[] = []
  const plugin = (id: `builtin.${string}`, fail = false): BuiltinPlugin<object> => ({
    id,
    activate(context) {
      events.push(`activate:${id}`)
      context.subscriptions.add(() => {
        events.push(`dispose:${id}`)
      })
      if (fail) throw new Error("activation failed")
    },
  })

  const host = new PluginHost({}, (failure) => events.push(`error:${failure.pluginId}:${failure.phase}`))
  await host.activate([plugin("builtin.one"), plugin("builtin.broken", true), plugin("builtin.two")])
  await host.dispose()

  expect(events).toEqual([
    "activate:builtin.one",
    "activate:builtin.broken",
    "dispose:builtin.broken",
    "error:builtin.broken:activate",
    "activate:builtin.two",
    "dispose:builtin.two",
    "dispose:builtin.one",
  ])
})

test("duplicate plugin IDs are rejected before anything activates", async () => {
  let activations = 0
  const duplicate: BuiltinPlugin<object> = {
    id: "builtin.duplicate",
    activate() {
      activations++
    },
  }
  const host = new PluginHost({})

  expect(host.activate([duplicate, duplicate])).rejects.toThrow('Duplicate plugin ID "builtin.duplicate"')
  expect(activations).toBe(0)
})

test("a failing error reporter cannot stop independent plugins", async () => {
  const activated: string[] = []
  const broken: BuiltinPlugin<object> = {
    id: "builtin.broken",
    activate() {
      throw new Error("broken")
    },
  }
  const healthy: BuiltinPlugin<object> = {
    id: "builtin.healthy",
    activate() {
      activated.push("healthy")
    },
  }
  const host = new PluginHost({}, () => {
    throw new Error("reporter failed")
  })

  await host.activate([broken, healthy])
  await host.dispose()

  expect(activated).toEqual(["healthy"])
})

test("rollback disposal failures are reported alongside activation failures", async () => {
  const failures: string[] = []
  const broken: BuiltinPlugin<object> = {
    id: "builtin.broken",
    activate(context) {
      context.subscriptions.add(() => {
        throw new Error("rollback failed")
      })
      throw new Error("activation failed")
    },
  }
  const host = new PluginHost({}, ({ phase, error }) => {
    failures.push(`${phase}:${error instanceof Error ? error.message : String(error)}`)
  })

  await host.activate([broken])

  expect(failures).toEqual(["dispose:rollback failed", "activate:activation failed"])
})

test("an aborted activation pass does not start another plugin", async () => {
  const controller = new AbortController()
  const activated: string[] = []
  const first: BuiltinPlugin<object> = {
    id: "builtin.first",
    activate() {
      activated.push("first")
      controller.abort("stop")
    },
  }
  const second: BuiltinPlugin<object> = {
    id: "builtin.second",
    activate() {
      activated.push("second")
    },
  }
  const host = new PluginHost({})

  await host.activate([first, second], controller.signal)

  expect(activated).toEqual(["first"])
})

test("abort rolls back a plugin after cooperative activation quiesces", async () => {
  const controller = new AbortController()
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  let disposed = false
  const pending: BuiltinPlugin<{ signal: AbortSignal }> = {
    id: "builtin.pending",
    activate(context) {
      context.subscriptions.add(() => {
        disposed = true
      })
      markStarted()
      return new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }))
    },
  }
  const host = new PluginHost({ signal: controller.signal })
  const activation = host.activate([pending], controller.signal)

  await started
  controller.abort("stop")
  const outcome = await Promise.race([
    activation.then(() => "stopped"),
    Bun.sleep(100).then(() => "timeout"),
  ])

  expect(outcome).toBe("stopped")
  expect(disposed).toBe(true)
})
