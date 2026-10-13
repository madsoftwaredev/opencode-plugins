#!/usr/bin/env bun
/**
 * Publishes ONE package: `bun scripts/publish.ts <package-directory> --expected-version <version>`.
 *
 * The release workflow calls this once per release tag, so a version bump in one
 * package never touches a sibling. The expected version comes from the tag and
 * is checked against the package manifest, which keeps the tag, the published
 * artifact, and the source revision tied together. Provenance is requested
 * explicitly because it only works inside CI with OIDC.
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { planRelease } from "./release.ts";

type Target = {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
};

function parseArgs(argv: readonly string[]) {
  const options = {
    dir: undefined as string | undefined,
    expectedVersion: undefined as string | undefined,
    provenance: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--expected-version") {
      options.expectedVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--provenance") {
      options.provenance = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg.startsWith("-") || options.dir !== undefined) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    options.dir = arg;
  }

  if (options.dir === undefined) {
    throw new Error("Pass the package directory, for example: stats");
  }

  return options;
}

/** A missing package is expected data; anything else must fail loudly. */
function isMissingFromRegistry(stderr: string): boolean {
  return stderr.includes("E404") || stderr.includes(" 404 ");
}

async function readPackage(dir: string): Promise<Target> {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No package.json at ${manifestPath}. Pass a packages/<name> directory.`);
  }

  const manifest = (await Bun.file(manifestPath).json()) as { name?: unknown; version?: unknown };
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error(`${manifestPath} needs both a name and a version.`);
  }

  return { name: manifest.name, version: manifest.version, dir };
}

/** Resolves the version published at exactly <version>, or null when it is absent. */
async function readPublishedVersion(name: string, version: string): Promise<string | null> {
  const spec = `${name}@${version}`;
  const { stdout, stderr, exitCode } = await $`npm view ${spec} version`.quiet().nothrow();

  if (exitCode === 0) {
    const published = stdout.toString().trim();
    return published.length > 0 ? published : null;
  }

  const error = stderr.toString();
  if (isMissingFromRegistry(error)) return null;

  throw new Error(`Could not read ${spec} from the registry:\n${error.trim()}`);
}

async function publish(pkg: Target, options: { provenance: boolean }): Promise<void> {
  const args = ["publish", "--access", "public"];
  if (options.provenance) args.push("--provenance");

  const proc = Bun.spawn(["npm", ...args], {
    cwd: pkg.dir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`npm publish failed for ${pkg.name}@${pkg.version} (exit ${exitCode}).`);
  }
}

async function main(): Promise<number> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const dir = resolve(options.dir ?? "");
    const pkg = await readPackage(dir);

    if (options.expectedVersion !== undefined && options.expectedVersion !== pkg.version) {
      throw new Error(
        `Tag expects ${pkg.name}@${options.expectedVersion}, but ${pkg.dir} declares ` +
          `${pkg.version}. Bump the manifest or fix the tag before releasing.`
      );
    }

    const plan = await planRelease(pkg.name, pkg.version, {
      readPublishedVersion: () => readPublishedVersion(pkg.name, pkg.version),
    });

    if (plan.status === "skip") {
      console.log(plan.reason);
      return 0;
    }

    const from = plan.publishedVersion ?? "no published version";
    console.log(`Publishing ${pkg.name}@${pkg.version} from ${pkg.dir} (registry has ${from}).`);

    if (options.dryRun) {
      console.log("Dry run: skipped npm publish.");
      return 0;
    }

    await publish(pkg, { provenance: options.provenance });

    console.log(`Published ${pkg.name}@${pkg.version}.`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

process.exit(await main());
