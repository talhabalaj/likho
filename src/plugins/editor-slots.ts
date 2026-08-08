import type { CoreSlotRegistry, SlotRenderable } from "@opentui/core"

export type EditorSlotName = "primary-sidebar" | "editor-frame"
export type EditorSlotRegistry = CoreSlotRegistry<EditorSlotName, object, object>
export type PrimarySidebarSlot = SlotRenderable<EditorSlotName, object, object>
