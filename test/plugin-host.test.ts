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
