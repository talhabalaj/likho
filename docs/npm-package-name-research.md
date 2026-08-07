# npm package name research

Checked 2026-08-08 against the official npm registry and npm policy documentation.

## Recommendation

Use **`sweedit`** for both the package and command: `npx sweedit`.

It is seven characters, reads as “sweet editor,” and the exact [registry endpoint](https://registry.npmjs.org/sweedit) returns 404. The official [registry search](https://registry.npmjs.org/-/v1/search?text=sweedit&size=8) also returns no nearby result.

Backups:

1. **`vsweet`** — preserves “Very Sweet”; its [exact registry endpoint](https://registry.npmjs.org/vsweet) returns 404 and [registry search](https://registry.npmjs.org/-/v1/search?text=vsweet&size=8) returns no result.
2. **`sweetedit`** — clearest description; its [exact registry endpoint](https://registry.npmjs.org/sweetedit) returns 404 and [registry search](https://registry.npmjs.org/-/v1/search?text=sweetedit&size=8) returns no result.

Availability is point-in-time; publishing is the final check.

## Required candidates checked

| Name | Official registry result | Verdict |
| --- | --- | --- |
| `vscli` | [No exact record](https://registry.npmjs.org/vscli), but [`vs-cli` exists](https://registry.npmjs.org/vs-cli) | Avoid: npm says names must not be confusingly similar. |
| `vsedit` | [No exact record](https://registry.npmjs.org/vsedit) | Viable, but sounds tied to Visual Studio. |
| `sweetcli` | [No exact record](https://registry.npmjs.org/sweetcli); [search](https://registry.npmjs.org/-/v1/search?text=sweetcli&size=8) finds `ayoub.sweetcli` | Avoid needless confusion. |
| `sweetedit` | [No exact record](https://registry.npmjs.org/sweetedit) | Backup. |
| `vscly` | [No exact record](https://registry.npmjs.org/vscly) | Avoid: typo-like and still close to `vs-cli`. |
| `verysweetcli` | [No exact record](https://registry.npmjs.org/verysweetcli) | Available-looking, but longer and less editor-specific. |

npm's [package-name guidelines](https://docs.npmjs.com/package-name-guidelines/) require an unscoped name to be unique and not confusingly similar to an existing package. That makes `vscli` risky despite the exact-name 404.

## Can `vs-cli` be reassigned?

Not merely because it is old, little-used, or lacks a README. npm uses first-come, first-served ownership, does not transfer a name simply because someone else wants it, and defines a squatted package as one with “no genuine function.” See npm's [package-name dispute policy](https://docs.npmjs.com/policies/disputes/).

There is credible evidence that this package is nonfunctional: [`vs-cli@0.0.1` registry metadata](https://registry.npmjs.org/vs-cli) has no `bin`, and its official [tarball](https://registry.npmjs.org/vs-cli/-/vs-cli-0.0.1.tgz) contains only `package.json`, with empty `main` and scripts. That fits npm's stated squatting definition better than age or download count does, but npm still does not promise a forced transfer on that basis.

The practical path is:

1. Contact the current owner and request a voluntary transfer; npm documents transfer through `npm owner add` / `npm owner rm` in its [transfer guide](https://docs.npmjs.com/transferring-a-package-from-a-user-account-to-another-user-account/) and [`npm owner` reference](https://docs.npmjs.com/cli/v12/commands/npm-owner).
2. If the owner does not respond, a formal trademark or other owned-IP claim is the only forced name-dispute route npm says it acts on. Otherwise, use another name. Do not offer payment; npm's policy prohibits buying or selling names.

## Short names (3–6 characters)

Checked 2026-08-08. The single best choice is **`swtty`**: `npx swtty` is five characters, sounds like “sweety,” and combines “sweet” with TTY. Its [exact registry endpoint](https://registry.npmjs.org/swtty) returns 404 and its [registry search](https://registry.npmjs.org/-/v1/search?text=swtty&size=6) returns no result.

Five best:

1. **`swtty`** — “sweety” + TTY; [exact](https://registry.npmjs.org/swtty) 404, [search](https://registry.npmjs.org/-/v1/search?text=swtty&size=6) zero.
2. **`ttyed`** — compact Unix-native description; [exact](https://registry.npmjs.org/ttyed) 404, [search](https://registry.npmjs.org/-/v1/search?text=ttyed&size=6) zero.
3. **`swtxt`** — compact “sweet text”; [exact](https://registry.npmjs.org/swtxt) 404, [search](https://registry.npmjs.org/-/v1/search?text=swtxt&size=6) zero.
4. **`swty`** — shortest readable “sweet” form; [exact](https://registry.npmjs.org/swty) 404, [search](https://registry.npmjs.org/-/v1/search?text=swty&size=6) zero.
5. **`vsly`** — compact “Very Sweet”; [exact](https://registry.npmjs.org/vsly) 404, [search](https://registry.npmjs.org/-/v1/search?text=vsly&size=6) zero.

Full screen:

| Name | Exact registry record | Official search collision | Assessment |
| --- | --- | --- | --- |
| `swee` | [Registered](https://registry.npmjs.org/swee) | [6 results](https://registry.npmjs.org/-/v1/search?text=swee&size=6) | Unavailable. |
| `swed` | [Registered](https://registry.npmjs.org/swed) | [4 results](https://registry.npmjs.org/-/v1/search?text=swed&size=6) | Unavailable. |
| `swedit` | [404](https://registry.npmjs.org/swedit) | [0 results](https://registry.npmjs.org/-/v1/search?text=swedit&size=6) | Avoid: an older text editor already uses this name outside npm. |
| `sedit` | [404](https://registry.npmjs.org/sedit) | [2 similar names](https://registry.npmjs.org/-/v1/search?text=sedit&size=6) | Viable, but less distinct. |
| `sved` | [404](https://registry.npmjs.org/sved) | [1 unrelated result](https://registry.npmjs.org/-/v1/search?text=sved&size=6) | Cryptic. |
| `svedit` | [Registered](https://registry.npmjs.org/svedit) | [Exact result](https://registry.npmjs.org/-/v1/search?text=svedit&size=6) | Unavailable. |
| `vsed` | [404](https://registry.npmjs.org/vsed) | [1 VS Code-related result](https://registry.npmjs.org/-/v1/search?text=vsed&size=6) | Avoid Visual Studio/VS Code implication. |
| `vse` | [Registered](https://registry.npmjs.org/vse) | [42 results](https://registry.npmjs.org/-/v1/search?text=vse&size=6) | Unavailable and noisy. |
| `svi` | [Registered](https://registry.npmjs.org/svi) | [29 results](https://registry.npmjs.org/-/v1/search?text=svi&size=6) | Unavailable. |
| `svim` | [Registered](https://registry.npmjs.org/svim) | [Exact result](https://registry.npmjs.org/-/v1/search?text=svim&size=6) | Unavailable. |
| `suvi` | [404](https://registry.npmjs.org/suvi) | [1 unrelated result](https://registry.npmjs.org/-/v1/search?text=suvi&size=6) | Short, but implies Vim/Vi. |
| `vecli` | [404](https://registry.npmjs.org/vecli) | [0 results](https://registry.npmjs.org/-/v1/search?text=vecli&size=6) | Clean registry, unclear name. |
| `swcli` | [404](https://registry.npmjs.org/swcli) | [0 results](https://registry.npmjs.org/-/v1/search?text=swcli&size=6) | Good fifth choice. |
| `ttyed` | [404](https://registry.npmjs.org/ttyed) | [0 results](https://registry.npmjs.org/-/v1/search?text=ttyed&size=6) | Strong terminal-specific backup. |
| `tedit` | [Registered](https://registry.npmjs.org/tedit) | [12 results](https://registry.npmjs.org/-/v1/search?text=tedit&size=6) | Unavailable. |
| `tued` | [404](https://registry.npmjs.org/tued) | [1 similar name](https://registry.npmjs.org/-/v1/search?text=tued&size=6) | Unclear pronunciation. |
| `editui` | [404](https://registry.npmjs.org/editui) | [2 similar names](https://registry.npmjs.org/-/v1/search?text=editui&size=6) | Clear, but sounds like a UI library. |
| `txtly` | [404](https://registry.npmjs.org/txtly) | [0 results](https://registry.npmjs.org/-/v1/search?text=txtly&size=6) | Avoid: an existing email platform uses this name. |
| `texty` | [Registered](https://registry.npmjs.org/texty) | [21 results](https://registry.npmjs.org/-/v1/search?text=texty&size=6) | Unavailable and crowded. |
| `inkly` | [404](https://registry.npmjs.org/inkly) | [23 results, including Inkly packages](https://registry.npmjs.org/-/v1/search?text=inkly&size=6) | Avoid existing brand confusion. |
| `editty` | [404](https://registry.npmjs.org/editty) | [0 results](https://registry.npmjs.org/-/v1/search?text=editty&size=6) | Avoid: a terminal editor on PyPI already uses this name. |
| `swtty` | [404](https://registry.npmjs.org/swtty) | [0 results](https://registry.npmjs.org/-/v1/search?text=swtty&size=6) | **Best.** |
| `swtxt` | [404](https://registry.npmjs.org/swtxt) | [0 results](https://registry.npmjs.org/-/v1/search?text=swtxt&size=6) | Strong descriptive backup. |
| `swty` | [404](https://registry.npmjs.org/swty) | [0 results](https://registry.npmjs.org/-/v1/search?text=swty&size=6) | Short, but less obvious to pronounce. |
| `vsly` | [404](https://registry.npmjs.org/vsly) | [0 results](https://registry.npmjs.org/-/v1/search?text=vsly&size=6) | Very short, but meaning is less obvious. |

As above, a 404 is a current observation rather than a reservation; the publish request remains npm's final availability check.
