export type RuntimeReport = Readonly<{
  getReport?: () => Readonly<{ header?: Readonly<{ glibcVersionRuntime?: string }> }>
}>

export function releaseAsset(platform?: string, arch?: string, report?: RuntimeReport): string

export function installReleaseBinary(options: Readonly<{
  version: string
  asset: string
  destination: string
  releaseBaseUrl: string
}>): Promise<void>

export function launchLikho(argv?: readonly string[]): Promise<number>
