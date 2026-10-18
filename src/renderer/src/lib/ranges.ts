/** A range of source lines, 0-based, `to` exclusive. Shared by the change tracker
 *  (lib/logic/changes.ts) and the reader's change highlights. */
export interface LineRange {
  from: number
  to: number
}
