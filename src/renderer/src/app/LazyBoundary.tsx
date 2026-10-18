import { Component, type ReactNode } from 'react'

// Catches a lazy part that failed to load (or threw while rendering), so one broken
// panel can't take the whole window down. Shows `fallback` (nothing by default) and
// tries again when its `resetKey` changes.

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /** Change it (e.g. the document id) to retry after a failure. */
  resetKey?: string | number | null
}

interface State {
  failed: boolean
  key: Props['resetKey']
}

export default class LazyBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}
