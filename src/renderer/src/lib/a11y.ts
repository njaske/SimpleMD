import type { KeyboardEvent } from 'react'

/** Make a clickable element behave like a button under the keyboard:
 *  Enter or Space activates it. Use together with role="button" + tabIndex={0}. */
export function activateOnKey(handler: () => void) {
  return (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler()
    }
  }
}
