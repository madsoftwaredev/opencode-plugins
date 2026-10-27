/** CLI plugin options, supplied through the package entry in cli.json. */
export type Options = {
  /** Whether newly encountered summaries start expanded. Defaults to false. */
  defaultExpanded: boolean;
};

export function parseOptions(options: Record<string, unknown>): Options {
  if (options.defaultExpanded !== undefined && typeof options.defaultExpanded !== "boolean") {
    throw new TypeError("compaction-fold: defaultExpanded must be a boolean");
  }
  return { defaultExpanded: options.defaultExpanded === true };
}
