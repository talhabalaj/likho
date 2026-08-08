import { expect, test } from "bun:test"
import { ExplorerTree } from "../src/explorer-tree"
import type { ExplorerNode, ExplorerNodeId, ExplorerSource } from "../src/explorer-source"

const root: ExplorerNode = { id: ".", name: "workspace", kind: "directory", absolutePath: "/workspace" }

function directory(id: string, parentId = "."): ExplorerNode {
  return { id, parentId, name: id.split("/").at(-1)!, kind: "directory", absolutePath: `/workspace/${id}` }
}

function file(id: string, parentId = "."): ExplorerNode {
  return { id, parentId, name: id.split("/").at(-1)!, kind: "file", absolutePath: `/workspace/${id}` }
}

function source(
  entries: Readonly<Record<ExplorerNodeId, readonly ExplorerNode[]>>,
  reads: ExplorerNodeId[],
): ExplorerSource {
  return {
    root,
    async children(id) {
      reads.push(id)
      return entries[id] ?? []
    },
  }
}

test("the Explorer loads directories lazily and follows VS Code right-arrow navigation", async () => {
  const reads: ExplorerNodeId[] = []
  const tree = new ExplorerTree(
    source(
      {
        ".": [directory("src"), file("README.md")],
        src: [directory("src/components", "src"), file("src/index.ts", "src")],
      },
      reads,
    ),
  )

  await tree.dispatch({ type: "initialize" })
  expect(reads).toEqual(["."])
  expect(tree.snapshot.rows.map(({ id, depth, selected }) => [id, depth, selected])).toEqual([
    ["src", 0, true],
    ["README.md", 0, false],
  ])

  await tree.dispatch({ type: "right" })
  expect(reads).toEqual([".", "src"])
  expect(tree.snapshot.rows.map(({ id, depth, selected }) => [id, depth, selected])).toEqual([
    ["src", 0, true],
    ["src/components", 1, false],
    ["src/index.ts", 1, false],
    ["README.md", 0, false],
  ])

  await tree.dispatch({ type: "right" })
  expect(tree.snapshot.selectedId).toBe("src/components")
})

test("Explorer movement, activation, and left-arrow navigation stay inside the visible tree", async () => {
  const tree = new ExplorerTree(
    source({ ".": [directory("src"), file("README.md")], src: [file("src/index.ts", "src")] }, []),
  )
  await tree.dispatch({ type: "initialize" })

  await tree.dispatch({ type: "move", delta: 1 })
  expect(await tree.dispatch({ type: "activate" })).toEqual({ type: "open-file", path: "/workspace/README.md" })

  await tree.dispatch({ type: "select", id: "src" })
  await tree.dispatch({ type: "activate" })
  await tree.dispatch({ type: "move", delta: 1 })
  expect(tree.snapshot.selectedId).toBe("src/index.ts")

  await tree.dispatch({ type: "left" })
  expect(tree.snapshot.selectedId).toBe("src")
  await tree.dispatch({ type: "left" })
  expect(tree.snapshot.rows.map(({ id }) => id)).toEqual(["src", "README.md"])
})

test("collapsing a loading directory rejects its stale children", async () => {
  let finishFirstRead!: (children: readonly ExplorerNode[]) => void
  const firstRead = new Promise<readonly ExplorerNode[]>((resolve) => {
    finishFirstRead = resolve
  })
  let srcReads = 0
  const tree = new ExplorerTree({
    root,
    async children(id) {
      if (id === ".") return [directory("src")]
      srcReads++
      if (srcReads === 1) return await firstRead
      return [file("src/fresh.ts", "src")]
    },
  })
  await tree.dispatch({ type: "initialize" })

  const expanding = tree.dispatch({ type: "right" })
  await Promise.resolve()
  await tree.dispatch({ type: "left" })
  finishFirstRead([file("src/stale.ts", "src")])
  await expanding

  await tree.dispatch({ type: "right" })
  expect(srcReads).toBe(2)
  expect(tree.snapshot.rows.map(({ id }) => id)).toEqual(["src", "src/fresh.ts"])
})

test("refresh preserves stable expansion and repairs a removed selection to its parent", async () => {
  let rootChildren: readonly ExplorerNode[] = [directory("src"), file("README.md")]
  let srcChildren: readonly ExplorerNode[] = [file("src/index.ts", "src")]
  const tree = new ExplorerTree({
    root,
    async children(id) {
      return id === "." ? rootChildren : srcChildren
    },
  })
  await tree.dispatch({ type: "initialize" })
  await tree.dispatch({ type: "right" })
  await tree.dispatch({ type: "right" })
  expect(tree.snapshot.selectedId).toBe("src/index.ts")

  srcChildren = [file("src/index.ts", "src"), file("src/new.ts", "src")]
  await tree.dispatch({ type: "refresh" })
  expect(tree.snapshot.selectedId).toBe("src/index.ts")
  expect(tree.snapshot.rows.map(({ id }) => id)).toEqual(["src", "src/index.ts", "src/new.ts", "README.md"])

  srcChildren = [file("src/new.ts", "src")]
  rootChildren = [directory("src"), file("README.md")]
  await tree.dispatch({ type: "refresh" })
  expect(tree.snapshot.selectedId).toBe("src")
})

test("directory errors stay local to their row and refresh can recover", async () => {
  let fail = true
  const tree = new ExplorerTree({
    root,
    async children(id) {
      if (id === ".") return [directory("src")]
      if (fail) throw new Error("Permission denied")
      return [file("src/index.ts", "src")]
    },
  })

  await tree.dispatch({ type: "initialize" })
  await tree.dispatch({ type: "right" })
  expect(tree.snapshot.rows.find(({ id }) => id === "src")?.error).toBe("Permission denied")

  fail = false
  await tree.dispatch({ type: "refresh" })
  expect(tree.snapshot.rows.map(({ id }) => id)).toEqual(["src", "src/index.ts"])
  expect(tree.snapshot.rows.find(({ id }) => id === "src")?.error).toBeUndefined()
})

test("revealing the active file lazily expands only its ancestors", async () => {
  const reads: ExplorerNodeId[] = []
  const tree = new ExplorerTree(
    source(
      {
        ".": [directory("src"), directory("test")],
        src: [directory("src/components", "src")],
        "src/components": [file("src/components/button.ts", "src/components")],
        test: [file("test/button.test.ts", "test")],
      },
      reads,
    ),
  )
  await tree.dispatch({ type: "initialize" })

  await tree.dispatch({ type: "reveal", id: "src/components/button.ts" })

  expect(reads).toEqual([".", "src", "src/components"])
  expect(tree.snapshot.selectedId).toBe("src/components/button.ts")
  expect(tree.snapshot.rows.find(({ active }) => active)?.id).toBe("src/components/button.ts")
})

test("disposing the Explorer aborts pending reads and ignores their results", async () => {
  let finishRead!: (children: readonly ExplorerNode[]) => void
  const read = new Promise<readonly ExplorerNode[]>((resolve) => {
    finishRead = resolve
  })
  let readSignal: AbortSignal | undefined
  const tree = new ExplorerTree({
    root,
    async children(_id, signal) {
      readSignal = signal
      return await read
    },
  })

  const initializing = tree.dispatch({ type: "initialize" })
  await Promise.resolve()
  tree.dispose()
  finishRead([file("late.ts")])
  await initializing

  expect(readSignal?.aborted).toBe(true)
  expect(tree.snapshot.rows).toEqual([])
})
