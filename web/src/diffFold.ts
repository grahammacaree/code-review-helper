/**
 * Re-export fold helpers from the server module (single source of truth).
 * Diff pane + design mode; agent budget lives on the server import path.
 */
export {
  foldUnifiedDiff,
  type DiffFold,
  type DiffFoldKind,
} from "../../server/diffFold.js";
