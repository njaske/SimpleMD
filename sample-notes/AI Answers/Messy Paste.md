# Comparing sorting algorithms

*Pasted from a chat app that mangled some of the Markdown. SimpleMD fixes what it safely can, for display only, and says so in the status bar. The file itself is never changed.*

## Complexity

The table below arrived without its divider row, which normally turns it into a paragraph of pipes:

| Algorithm | Best | Average | Worst | Stable |
| Merge sort | n log n | n log n | n log n | Yes |
| Quicksort | n log n | n log n | n² | No |
| Heapsort | n log n | n log n | n log n | No |
| Insertion sort | n | n² | n² | Yes |

## Quicksort's average case

The display formula was split by blank lines on the way over:

$$

C(n) = (n - 1) + \frac{2}{n} \sum_{k=0}^{n-1} C(k)

$$

which solves to \(C(n) \approx 2n \ln n \approx 1.39\, n \log_2 n\) comparisons.

## How a merge works

Autocorrect turned the diagram's quotes curly and its arrows into dashes, which Mermaid can't parse until they are straightened:

```mermaid
flowchart LR
  A[“Split the list (in halves)”] —> B[“Sort each half”]
  B —> C[“Merge (take the smaller head)”]
  C —> D[Sorted list]
```

## Insertion sort

```python
def insertion_sort(items):
    for i in range(1, len(items)):
        key = items[i]
        j = i - 1
        while j >= 0 and items[j] > key:
            items[j + 1] = items[j]
            j -= 1
        items[j + 1] = key
    return items
```
