// The slim formatting toolbar shown above the editor in Edit and Split modes only (Read
// stays clean). Groups that don't fit the pane fold into a "More" menu; every control has
// a tooltip with its shortcut, and the arrow keys move between controls (role=toolbar).
import { useCallback, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { Platform } from '@shared/types'
import type { FormatCommand } from '@/lib/editor/types'
import { formatShortcut } from '@/lib/logic/platform'
import { ariaShortcut } from '@/lib/editor/shortcuts'
import { FORMAT_GROUPS, HEADING_CHOICES, type FormatItem } from '@/lib/editor/formatItems'
import { ChevronDownIcon, HeadingIcon, MoreIcon } from '@/lib/editor/formatIcons'
import FormatMenu, { type FormatMenuItem } from '@/lib/editor/FormatMenu'
import { onRovingKey, useClampedLeft, useTooltip, useVisibleGroups, type Tip } from '@/lib/editor/useFormatBarUi'
import '@/styles/editor-ui.css'

export interface FormatBarProps {
  onFormat: (cmd: FormatCommand) => void
  /** For shortcut hints in tooltips (⌘B vs Ctrl+B). */
  platform: Platform
}

const GROUP_SIZES = FORMAT_GROUPS.map((g) => g.length)
const GROUP_LABELS = ['Text', 'Links and media', 'Lists and quotes', 'Blocks']

type MenuKind = 'heading' | 'more'

interface OpenMenu {
  readonly kind: MenuKind
  readonly keyboard: boolean
}

// Toolbar buttons never take focus from the editor on click: the selection stays put.
const keepEditorFocus = (e: MouseEvent): void => e.preventDefault()

function Tooltip({ tip, bar }: { tip: Tip; bar: RefObject<HTMLDivElement | null> }) {
  const el = useRef<HTMLDivElement>(null)
  const width = useCallback(() => bar.current?.clientWidth ?? 0, [bar])
  useClampedLeft(el, tip, width)
  return (
    <div ref={el} className="smd-fmt-tip" aria-hidden="true">
      <span>{tip.label}</span>
      {tip.hint && <kbd className="smd-fmt-tip__kbd">{tip.hint}</kbd>}
    </div>
  )
}

function headingItems(onFormat: FormatBarProps['onFormat'], hint: (s: string | null) => string | null): FormatMenuItem[] {
  return HEADING_CHOICES.map((choice) => ({
    key: choice.cmd,
    text: choice.label,
    label: choice.label,
    hint: hint(choice.shortcut),
    className: `smd-fmt-menu__item--h${choice.level}`,
    separatorBefore: choice.level === 0,
    onSelect: () => onFormat(choice.cmd)
  }))
}

function overflowItems(groups: readonly (readonly FormatItem[])[], onFormat: FormatBarProps['onFormat'], hint: (s: string | null) => string | null): FormatMenuItem[] {
  return groups.flatMap((group, g) =>
    group.map((it, i) => ({
      key: it.cmd,
      text: it.label,
      label: it.label,
      icon: <it.icon size={16} />,
      hint: hint(it.shortcut),
      separatorBefore: g > 0 && i === 0,
      onSelect: () => onFormat(it.cmd)
    }))
  )
}

export default function FormatBar({ onFormat, platform }: FormatBarProps) {
  const bar = useRef<HTMLDivElement>(null)
  const headingBtn = useRef<HTMLButtonElement>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const { tip, show, hide } = useTooltip(bar)
  const visible = useVisibleGroups(bar, GROUP_SIZES)

  const hint = useCallback((s: string | null) => (s ? formatShortcut(s, platform) : null), [platform])
  const aria = (s: string | null): string | undefined => (s ? ariaShortcut(s, platform) : undefined)

  const closeMenu = useCallback(
    (returnFocus: boolean) => {
      // Esc returns to the trigger when the keyboard was in the menu; a mouse-opened menu
      // never took focus from the editor, so there's nothing to restore.
      const focusInMenu = document.activeElement?.closest('.smd-fmt-menu') != null
      if (menu && returnFocus && (menu.keyboard || focusInMenu)) (menu.kind === 'heading' ? headingBtn : moreBtn).current?.focus()
      setMenu(null)
    },
    [menu]
  )

  const toggleMenu = (kind: MenuKind, keyboard: boolean): void => {
    hide()
    setMenu((open) => (open?.kind === kind ? null : { kind, keyboard }))
  }

  // Shared wiring for every focusable control: roving tabindex plus tooltip.
  let next = 0
  const control = (label: string, shortcut: string | null) => {
    const index = next++
    return {
      'data-roving': '',
      tabIndex: index === focusIndex ? 0 : -1,
      onFocus: (e: FocusEvent<HTMLElement>) => {
        setFocusIndex(index)
        if (e.currentTarget.matches(':focus-visible') && !menu) show(e.currentTarget, label, hint(shortcut))
      },
      onBlur: hide,
      onMouseEnter: (e: MouseEvent<HTMLElement>) => !menu && show(e.currentTarget, label, hint(shortcut)),
      onMouseLeave: hide,
      onMouseDown: (e: MouseEvent) => {
        keepEditorFocus(e)
        hide()
      }
    }
  }

  const button = (it: FormatItem): ReactNode => (
    <button
      key={it.cmd}
      type="button"
      className="smd-iconbtn smd-fmt-btn"
      aria-label={it.label}
      aria-keyshortcuts={aria(it.shortcut)}
      onClick={() => onFormat(it.cmd)}
      {...control(it.label, it.shortcut)}
    >
      <it.icon size={17} />
    </button>
  )

  const trigger = (kind: MenuKind, label: string, tipLabel: string, content: ReactNode): ReactNode => (
    <button
      ref={kind === 'heading' ? headingBtn : moreBtn}
      type="button"
      className={`smd-iconbtn smd-fmt-btn smd-fmt-trigger smd-fmt-trigger--${kind}` + (menu?.kind === kind ? ' is-active' : '')}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={menu?.kind === kind}
      aria-controls={menu?.kind === kind ? `smd-fmt-menu-${kind}` : undefined}
      onClick={(e) => toggleMenu(kind, e.detail === 0)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown') return
        e.preventDefault()
        if (menu?.kind !== kind) toggleMenu(kind, true)
      }}
      {...control(tipLabel, null)}
    >
      {content}
    </button>
  )

  const shownGroups = FORMAT_GROUPS.slice(0, visible)
  const hiddenGroups = FORMAT_GROUPS.slice(visible)

  return (
    <div ref={bar} className="smd-formatbar" role="toolbar" aria-label="Formatting" aria-orientation="horizontal" onKeyDown={onRovingKey}>
      <div className="smd-formatbar__inner">
        <div className="smd-fmt-anchor">
          {trigger('heading', 'Text style', 'Text style', (
            <>
              <HeadingIcon size={17} />
              <ChevronDownIcon size={11} />
            </>
          ))}
          {menu?.kind === 'heading' && (
            <FormatMenu id="smd-fmt-menu-heading" label="Text style" items={headingItems(onFormat, hint)} anchor={headingBtn} autoFocus={menu.keyboard} onClose={closeMenu} />
          )}
        </div>
        {shownGroups.map((group, g) => (
          <div key={GROUP_LABELS[g]} className="smd-fmt-group" role="group" aria-label={GROUP_LABELS[g]}>
            <span className="smd-divider-v smd-fmt-divider" aria-hidden="true" />
            {group.map(button)}
          </div>
        ))}
        {hiddenGroups.length > 0 && (
          <div className="smd-fmt-group smd-fmt-anchor">
            <span className="smd-divider-v smd-fmt-divider" aria-hidden="true" />
            {trigger('more', 'More formatting', 'More', <MoreIcon size={17} />)}
            {menu?.kind === 'more' && (
              <FormatMenu id="smd-fmt-menu-more" label="More formatting" items={overflowItems(hiddenGroups, onFormat, hint)} anchor={moreBtn} autoFocus={menu.keyboard} align="end" onClose={closeMenu} />
            )}
          </div>
        )}
      </div>
      {tip && <Tooltip tip={tip} bar={bar} />}
    </div>
  )
}
