// What the format bar shows, in order: the heading menu, then the button groups.
import type { ComponentType } from 'react'
import {
  BoldIcon,
  BulletListIcon,
  CodeBlockIcon,
  DividerIcon,
  ImageIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikeIcon,
  TableIcon,
  TaskListIcon,
  type FormatIconProps
} from './formatIcons'
import { shortcutFor } from './shortcuts'
import type { FormatCommand } from './types'

export interface FormatItem {
  readonly cmd: FormatCommand
  readonly label: string
  readonly icon: ComponentType<FormatIconProps>
  /** Portable shortcut ("Mod+B"), or null. */
  readonly shortcut: string | null
}

const item = (cmd: FormatCommand, label: string, icon: ComponentType<FormatIconProps>): FormatItem => ({
  cmd,
  label,
  icon,
  shortcut: shortcutFor(cmd)
})

export interface HeadingChoice {
  readonly cmd: FormatCommand
  readonly label: string
  /** Each row previews its own size. */
  readonly level: 1 | 2 | 3 | 0
  readonly shortcut: string | null
}

export const HEADING_CHOICES: readonly HeadingChoice[] = [
  { cmd: 'heading1', label: 'Heading 1', level: 1, shortcut: shortcutFor('heading1') },
  { cmd: 'heading2', label: 'Heading 2', level: 2, shortcut: shortcutFor('heading2') },
  { cmd: 'heading3', label: 'Heading 3', level: 3, shortcut: shortcutFor('heading3') },
  { cmd: 'paragraph', label: 'Paragraph', level: 0, shortcut: shortcutFor('paragraph') }
]

export const FORMAT_GROUPS: readonly (readonly FormatItem[])[] = [
  [
    item('bold', 'Bold', BoldIcon),
    item('italic', 'Italic', ItalicIcon),
    item('strikethrough', 'Strikethrough', StrikeIcon),
    item('code', 'Inline code', InlineCodeIcon)
  ],
  [item('link', 'Link', LinkIcon), item('image', 'Image', ImageIcon)],
  [
    item('quote', 'Quote', QuoteIcon),
    item('bulletList', 'Bulleted list', BulletListIcon),
    item('numberedList', 'Numbered list', NumberedListIcon),
    item('taskList', 'Task list', TaskListIcon)
  ],
  [item('codeBlock', 'Code block', CodeBlockIcon), item('table', 'Table', TableIcon), item('divider', 'Divider', DividerIcon)]
]
