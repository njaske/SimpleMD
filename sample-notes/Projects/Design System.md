# Design System

The visual language behind SimpleMD. Restraint first.

## Principles

- **Monochrome by default.** Color is a tool, not decoration.
- **One accent.** A single warm red, used only where it earns attention.
- **Type does the work.** Hierarchy from scale and weight, not boxes.

## Color

```css
:root {
  --ink: #1a1a1a;
  --paper: #ffffff;
  --accent: oklch(0.55 0.19 27);
}
```

## Type

Helvetica Neue for the interface. Generous line height for reading. Monospace only for code.

| Token | Size | Weight |
| --- | --- | --- |
| Display | 30px | 650 |
| Heading | 23px | 650 |
| Body | 16px | 400 |
| Caption | 13px | 400 |

> Whitespace is not empty. It is the design.
