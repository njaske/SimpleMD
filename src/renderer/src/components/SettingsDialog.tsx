import type { KeyboardEvent, ReactNode } from 'react'
import type { Platform, ReadingFont, ThemeName } from '@shared/types'
import type { SettingsSection } from '@/app/types'
import { ACCENTS, UI_SCALE } from '@/app/appearance'
import { COMMANDS, EDITOR_SHORTCUTS, GROUP_ORDER } from '@/lib/commands'
import { formatShortcut } from '@/lib/logic/platform'
import {
  AppMark,
  CheckIcon,
  CloseIcon,
  ContrastIcon,
  ExternalIcon,
  InfoIcon,
  KeyboardIcon,
  PenLineIcon,
  ShieldIcon,
  TypeIcon
} from '@/lib/icons'
import { version } from '../../../../package.json'
import Dialog from './Dialog'
import { FontPicker, LineHeightPicker, SizeStepper, ThemePicker, WidthPicker } from './ReadingControls'

// Settings sheet: left nav, live-applying controls on the right. Mod+, opens it;
// Mod+/ opens it on Shortcuts.

export interface SettingsValues {
  theme: ThemeName
  accent: string
  uiScale: number
  reduceMotion: boolean
  showStatusBar: boolean
  readingFont: ReadingFont
  readingSize: number
  lineHeight: number
  readingWidth: number
  blockRemoteImages: boolean
  syncScroll: boolean
}

export interface SettingsDialogProps {
  section: SettingsSection
  values: SettingsValues
  platform: Platform
  onSection: (s: SettingsSection) => void
  onChange: (patch: Partial<SettingsValues>) => void
  onOpenLink: (url: string) => void
  onClose: () => void
}

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <ContrastIcon size={15} /> },
  { id: 'reading', label: 'Reading', icon: <TypeIcon size={15} /> },
  { id: 'editor', label: 'Editor', icon: <PenLineIcon size={15} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <KeyboardIcon size={15} /> },
  { id: 'about', label: 'About', icon: <InfoIcon size={15} /> }
]

const LINKS = {
  website: 'https://njaske.github.io/SimpleMD/',
  github: 'https://github.com/njaske/SimpleMD',
  license: 'https://github.com/njaske/SimpleMD/blob/main/LICENSE'
}

function Setting({
  label,
  desc,
  children,
  stack
}: {
  label: string
  desc?: string
  children: ReactNode
  stack?: boolean
}) {
  return (
    <div className={'smd-setting' + (stack ? ' smd-setting--stack' : '')}>
      <div className="smd-setting-text">
        <div className="smd-setting-label">{label}</div>
        {desc && <div className="smd-setting-desc">{desc}</div>}
      </div>
      <div className="smd-setting-control">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="smd-switch"
      onClick={() => onChange(!checked)}
    />
  )
}

function Appearance({ values: v, onChange }: SettingsDialogProps) {
  return (
    <>
      <Setting label="Theme" desc="System follows your computer's light or dark setting." stack>
        <div style={{ width: 300 }}>
          <ThemePicker value={v.theme} onChange={(theme) => onChange({ theme })} />
        </div>
      </Setting>
      <Setting label="Accent color" desc="Used for links, selection and the active item.">
        <div className="smd-swatches" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((a) => {
            const on = v.accent.toLowerCase() === a.value
            return (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={a.name}
                title={a.name}
                className="smd-swatch"
                style={{ background: a.value }}
                onClick={() => onChange({ accent: a.value })}
              >
                {on && <CheckIcon size={13} />}
              </button>
            )
          })}
        </div>
      </Setting>
      <Setting label="Interface size" desc="Scales the whole window, text and controls.">
        <div className="smd-scale">
          <input
            className="smd-range"
            type="range"
            min={UI_SCALE.min * 100}
            max={UI_SCALE.max * 100}
            step={UI_SCALE.step * 100}
            value={Math.round(v.uiScale * 100)}
            aria-label="Interface size"
            aria-valuetext={`${Math.round(v.uiScale * 100)} percent`}
            onChange={(e) => onChange({ uiScale: Number(e.target.value) / 100 })}
          />
          <output>{Math.round(v.uiScale * 100)}%</output>
        </div>
      </Setting>
      <Setting label="Reduce motion" desc="Turn off animations, even if your system allows them.">
        <Switch
          label="Reduce motion"
          checked={v.reduceMotion}
          onChange={(reduceMotion) => onChange({ reduceMotion })}
        />
      </Setting>
      <Setting label="Show status bar" desc="Folder, save state and reading time at the bottom.">
        <Switch
          label="Show status bar"
          checked={v.showStatusBar}
          onChange={(showStatusBar) => onChange({ showStatusBar })}
        />
      </Setting>
    </>
  )
}

function Reading({ values: v, onChange }: SettingsDialogProps) {
  return (
    <>
      <Setting label="Font" stack>
        <FontPicker value={v.readingFont} onChange={(readingFont) => onChange({ readingFont })} />
      </Setting>
      <Setting label="Text size">
        <div style={{ width: 160 }}>
          <SizeStepper value={v.readingSize} onChange={(readingSize) => onChange({ readingSize })} />
        </div>
      </Setting>
      <Setting label="Line height">
        <div style={{ width: 300 }}>
          <LineHeightPicker value={v.lineHeight} onChange={(lineHeight) => onChange({ lineHeight })} />
        </div>
      </Setting>
      <Setting label="Page width">
        <div style={{ width: 300 }}>
          <WidthPicker value={v.readingWidth} onChange={(readingWidth) => onChange({ readingWidth })} />
        </div>
      </Setting>
      <Setting
        label="Block remote images"
        desc="Images from the web load only when you ask, so opening a file never contacts a server."
      >
        <Switch
          label="Block remote images"
          checked={v.blockRemoteImages}
          onChange={(blockRemoteImages) => onChange({ blockRemoteImages })}
        />
      </Setting>
    </>
  )
}

function Editor({ values: v, onChange }: SettingsDialogProps) {
  return (
    <Setting
      label="Synced scrolling"
      desc="In Split view, the preview follows the editor as you scroll, and the other way round."
    >
      <Switch label="Synced scrolling" checked={v.syncScroll} onChange={(syncScroll) => onChange({ syncScroll })} />
    </Setting>
  )
}

function Keys({ shortcut, platform }: { shortcut: string; platform: Platform }) {
  return <span className="smd-kbd">{formatShortcut(shortcut, platform)}</span>
}

function Shortcuts({ platform }: SettingsDialogProps) {
  return (
    <>
      {GROUP_ORDER.map((group) => {
        const rows = COMMANDS.filter((c) => c.group === group && c.shortcuts?.length)
        if (!rows.length) return null
        return (
          <section key={group} className="smd-shortcut-group">
            <h3>{group}</h3>
            {rows.map((c) => (
              <div key={c.id} className="smd-shortcut-row">
                <span>{c.label}</span>
                <span className="smd-shortcut-keys">
                  {c.shortcuts?.map((s) => (
                    <Keys key={s} shortcut={s} platform={platform} />
                  ))}
                </span>
              </div>
            ))}
          </section>
        )
      })}
      <section className="smd-shortcut-group">
        <h3>In the editor</h3>
        {EDITOR_SHORTCUTS.map((e) => (
          <div key={e.label} className="smd-shortcut-row">
            <span>{e.label}</span>
            <Keys shortcut={e.shortcut} platform={platform} />
          </div>
        ))}
      </section>
    </>
  )
}

function About({ onOpenLink }: SettingsDialogProps) {
  return (
    <div className="smd-about">
      <AppMark size={44} style={{ color: 'var(--fg)' }} />
      <h3 className="smd-about-name">SimpleMD</h3>
      <div className="smd-about-version">Version {version}</div>
      <p className="smd-about-tag">A calm, private reader for everything your AI writes.</p>
      <div className="smd-about-links">
        <button type="button" className="smd-btn smd-btn--sm" onClick={() => onOpenLink(LINKS.website)}>
          Website <ExternalIcon size={13} />
        </button>
        <button type="button" className="smd-btn smd-btn--sm" onClick={() => onOpenLink(LINKS.github)}>
          GitHub <ExternalIcon size={13} />
        </button>
        <button type="button" className="smd-btn smd-btn--sm" onClick={() => onOpenLink(LINKS.license)}>
          MIT license <ExternalIcon size={13} />
        </button>
      </div>
      <div className="smd-privacy">
        <ShieldIcon size={18} />
        <div>
          <strong>No network requests, ever.</strong> SimpleMD has no accounts, analytics or update pings. Your
          documents stay on your computer.
        </div>
      </div>
    </div>
  )
}

const TITLES: Record<SettingsSection, { title: string; sub: string }> = {
  appearance: { title: 'Appearance', sub: 'How SimpleMD looks.' },
  reading: { title: 'Reading', sub: 'How documents read. Changes apply right away.' },
  editor: { title: 'Editor', sub: 'Writing and editing Markdown.' },
  shortcuts: { title: 'Keyboard shortcuts', sub: 'Every command is also in the command palette.' },
  about: { title: 'About', sub: '' }
}

const BODIES: Record<SettingsSection, (p: SettingsDialogProps) => ReactNode> = {
  appearance: Appearance,
  reading: Reading,
  editor: Editor,
  shortcuts: Shortcuts,
  about: About
}

export default function SettingsDialog(p: SettingsDialogProps) {
  const Body = BODIES[p.section]
  const head = TITLES[p.section]
  const index = SECTIONS.findIndex((s) => s.id === p.section)
  const onNavKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + SECTIONS.length) % SECTIONS.length
    p.onSection(SECTIONS[next].id)
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }
  return (
    <Dialog bare label="Settings" onClose={p.onClose}>
      <div className="smd-settings">
        <div
          className="smd-settings-nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings sections"
          onKeyDown={onNavKey}
        >
          <div className="smd-settings-nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`smd-set-tab-${s.id}`}
              aria-selected={s.id === p.section}
              aria-controls="smd-set-panel"
              tabIndex={s.id === p.section ? 0 : -1}
              data-autofocus={s.id === p.section ? '' : undefined}
              className="smd-settings-tab"
              onClick={() => p.onSection(s.id)}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
        <div
          className="smd-settings-body"
          id="smd-set-panel"
          role="tabpanel"
          aria-labelledby={`smd-set-tab-${p.section}`}
        >
          {p.section !== 'about' && (
            <>
              <h2 className="smd-settings-h">{head.title}</h2>
              <p className="smd-settings-sub">{head.sub}</p>
            </>
          )}
          <Body {...p} />
        </div>
        <button
          type="button"
          className="smd-iconbtn smd-settings-close"
          onClick={p.onClose}
          aria-label="Close settings"
          title="Close"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </Dialog>
  )
}
