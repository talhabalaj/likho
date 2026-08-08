export type PlatformOptions = Readonly<{
  platform?: string
  arch?: string
  musl?: boolean
}>

export function packageNames(options?: PlatformOptions): string[]
export function copyBinary(source: string, target: string): void
export function install(options?: Omit<PlatformOptions, "musl">): void
