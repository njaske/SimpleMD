// Small least-recently-used cache for string results, bounded by entry count and
// total characters so caching big rendered documents can't grow without limit.

export class TextCache {
  private map = new Map<string, string>()
  private chars = 0
  private maxEntries: number
  private maxChars: number

  constructor(maxEntries: number, maxChars: number) {
    this.maxEntries = maxEntries
    this.maxChars = maxChars
  }

  get(key: string): string | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    // Re-insert so the most recently used entry is last in iteration order.
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: string): void {
    this.delete(key)
    const cost = key.length + value.length
    if (cost > this.maxChars) return
    this.map.set(key, value)
    this.chars += cost
    for (const oldest of this.map.keys()) {
      if (this.map.size <= this.maxEntries && this.chars <= this.maxChars) break
      this.delete(oldest)
    }
  }

  private delete(key: string): void {
    const value = this.map.get(key)
    if (value === undefined) return
    this.chars -= key.length + value.length
    this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }
}
