import { disableTool } from "eve/tools";

/**
 * Disables the built-in edit_file tool for the same reason as write_file, so the model makes changes through the Contentful tools rather than sandbox files.
 *
 * @remarks edit_file changes existing sandbox files without write_file, so both stay disabled together. This steers the model and isn't a security control, because `bash` can still write inside the sandbox.
 */
export default disableTool();
