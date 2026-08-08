# Releasing Likho

Likho uses the same split-package shape as OpenCode:

- `likho` is a tiny npm wrapper with platform packages in `optionalDependencies`.
- `likho-<os>-<cpu>[-musl]` contains one standalone Bun executable.
- GitHub Releases receives compressed copies of the same eight executables.

## Normal release

1. Update `version` in `package.json` and commit it with the release changes.
2. Tag that commit `v<version>` and push the tag.
3. The Release workflow tests and cross-compiles the project.
4. It creates the GitHub Release, publishes every native npm package, and publishes `likho` last.

Publishing is idempotent: rerunning the workflow skips exact package versions already present on npm.
The workflow uses npm trusted publishing and GitHub OIDC, so it does not need an `NPM_TOKEN` secret.

## One-time native-package bootstrap

npm can only configure a trusted publisher after a package exists. Before the first split-package
release, build and publish each currently unclaimed native package once using an npm maintainer login
with 2FA:

```sh
bun run release:build
npm publish dist/npm/likho-darwin-arm64 --access public
npm publish dist/npm/likho-darwin-x64 --access public
npm publish dist/npm/likho-linux-arm64 --access public
npm publish dist/npm/likho-linux-arm64-musl --access public
npm publish dist/npm/likho-linux-x64 --access public
npm publish dist/npm/likho-linux-x64-musl --access public
npm publish dist/npm/likho-windows-arm64 --access public
npm publish dist/npm/likho-windows-x64 --access public
```

Then use npm 11.15 or newer to authorize `.github/workflows/release.yml` for each package:

```sh
npm trust github <package-name> \
  --file release.yml \
  --repo talhabalaj/likho \
  --allow-publish \
  --yes
```

The existing `likho` package needs the same trusted-publisher settings. Once all nine packages trust
the workflow, future releases are tag-only and token-free.

## Local packaging check

```sh
bun test test/npm-installer.test.ts test/release-packaging.test.ts test/npm-publish.test.ts
bun run typecheck
bun run release:build
```

Pack the wrapper and the native package for the current machine, install both tarballs into a clean
temporary project, and verify `likho --version`. The postinstall step should replace
`bin/likho.exe` with a hard link to the installed native package when the filesystem allows it.
