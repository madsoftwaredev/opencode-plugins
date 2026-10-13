/**
 * Publishing model for this workspace.
 *
 * Every package under packages/ carries its own version and is released on its
 * own. A release tag is <package-directory>@<version>, for example
 * stats@0.1.3, and only that one package is published. The publish step reads
 * the registry first, so re-running a tag never republishes a version that is
 * already live.
 */

export type Plan =
  | { readonly status: "skip"; readonly reason: string }
  | { readonly status: "publish"; readonly publishedVersion: string | null }

export type PlanDeps = {
  /** Resolves the exact version in the registry, or null when that version is absent. */
  readonly readPublishedVersion: () => Promise<string | null>
}

/**
 * Decides whether <name>@<version> still needs publishing. Only the exact
 * version matters: a package published at 0.2.0 is still published from 0.1.2
 * when a sibling package moves.
 */
export async function planRelease(name: string, version: string, deps: PlanDeps): Promise<Plan> {
  const publishedVersion = await deps.readPublishedVersion();

  if (publishedVersion === version) {
    return { status: "skip", reason: `${name}@${version} is already published.` };
  }

  return { status: "publish", publishedVersion };
}
