import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { medianMs } from './support/logic-timing.ts'
import {
  addedPaths,
  ensureMdExtension,
  isAgentInstructionFile,
  isMarkdownName,
  normalizePastedMarkdown,
  suggestFileName,
  titleFromMarkdown,
  validateFileName
} from '../src/renderer/src/lib/logic/files.ts'

const ZWSP = String.fromCharCode(0x200b)
const WORD_JOINER = String.fromCharCode(0x2060)
const BOM = String.fromCharCode(0xfeff)
const ZWNJ = String.fromCharCode(0x200c)
const ZWJ = String.fromCharCode(0x200d)
const NBSP = String.fromCharCode(0xa0)
const NNBSP = String.fromCharCode(0x202f)

describe('isMarkdownName / ensureMdExtension', () => {
  it('recognizes Markdown extensions case-insensitively', () => {
    for (const name of ['a.md', 'A.MD', 'b.markdown', 'c.mdown', 'd.mkd', 'e.mdx', 'f.markdn']) {
      assert.ok(isMarkdownName(name), name)
    }
    assert.ok(!isMarkdownName('notes.txt'))
    assert.ok(!isMarkdownName('md'))
  })

  it('adds .md only when missing', () => {
    assert.equal(ensureMdExtension('notes'), 'notes.md')
    assert.equal(ensureMdExtension('notes.markdown'), 'notes.markdown')
    assert.equal(ensureMdExtension('notes.txt'), 'notes.txt.md')
  })
})

describe('validateFileName', () => {
  it('accepts ordinary names, including Unicode and inner dots/spaces', () => {
    for (const name of ['notes.md', 'Meeting notes 2024.md', 'café ☕.md', '日本語.md', '.hidden.md', 'a.b.c.md']) {
      assert.equal(validateFileName(name, 'win32'), null, name)
    }
  })

  it('asks for a name when empty or whitespace-only', () => {
    assert.equal(validateFileName('', 'linux'), 'Enter a name')
    assert.equal(validateFileName('   ', 'linux'), 'Enter a name')
  })

  it('treats a name made only of invisible characters as empty', () => {
    for (const name of [ZWSP, `${ZWSP}${ZWJ}`, `${BOM} ${WORD_JOINER}`, String.fromCharCode(0xad)]) {
      assert.equal(validateFileName(name, 'darwin'), 'Enter a name', JSON.stringify(name))
    }
  })

  it('refuses bidi override and isolate characters that can disguise an extension', () => {
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      const name = `notes${String.fromCharCode(code)}dm.exe`
      assert.equal(validateFileName(name, 'linux'), "A name can't contain hidden text-direction characters", code.toString(16))
    }
  })

  it('still accepts names whose emoji or scripts use joiners', () => {
    assert.equal(validateFileName(`👨${ZWJ}👩${ZWJ}👧 family.md`, 'win32'), null)
    assert.equal(validateFileName(`می${ZWNJ}خواهم.md`, 'win32'), null)
  })

  it('refuses "." and ".."', () => {
    assert.match(validateFileName('.', 'darwin') ?? '', /"\." or "\.\."/)
    assert.ok(validateFileName('..', 'darwin'))
  })

  it('refuses path separators with a message naming them', () => {
    assert.equal(validateFileName('a/b.md', 'linux'), "A name can't contain /")
    assert.equal(validateFileName('a\\b.md', 'linux'), "A name can't contain \\")
  })

  it('refuses characters Windows forbids, on every platform', () => {
    for (const ch of ['<', '>', ':', '"', '|', '?', '*']) {
      assert.equal(validateFileName(`a${ch}b.md`, 'darwin'), `A name can't contain ${ch}`)
    }
  })

  it('refuses control characters', () => {
    assert.equal(validateFileName('a\tb.md', 'linux'), "A name can't contain control characters")
    assert.equal(validateFileName('a\u0000b', 'linux'), "A name can't contain control characters")
  })

  it('refuses names ending in a dot or a space', () => {
    assert.equal(validateFileName('notes.', 'win32'), "A name can't end with a dot")
    assert.equal(validateFileName('notes ', 'win32'), "A name can't end with a space")
  })

  it('refuses Windows device names with or without an extension, any case', () => {
    for (const name of ['CON', 'con.md', 'Prn.txt', 'aux', 'NUL.tar.gz', 'COM1', 'com9.md', 'LPT1', 'lpt9.md', 'COM¹']) {
      assert.match(validateFileName(name, 'win32') ?? '', /reserved by Windows/, name)
    }
    assert.match(validateFileName('con.md', 'darwin') ?? '', /Windows reserves it/)
  })

  it('allows names that only start like a device name', () => {
    for (const name of ['console.md', 'CONTRACT.md', 'com10.md', 'lpt0.md', 'auxiliary.md', 'null.md']) {
      assert.equal(validateFileName(name, 'win32'), null, name)
    }
  })

  it('refuses names longer than 255 characters', () => {
    assert.equal(validateFileName(`${'a'.repeat(252)}.md`, 'win32'), null)
    assert.match(validateFileName(`${'a'.repeat(253)}.md`, 'win32') ?? '', /too long/)
  })

  it('refuses names longer than 255 UTF-8 bytes (the Linux limit)', () => {
    assert.match(validateFileName(`${'日'.repeat(90)}.md`, 'linux') ?? '', /too long/)
    assert.equal(validateFileName(`${'日'.repeat(80)}.md`, 'linux'), null)
  })
})

describe('isAgentInstructionFile', () => {
  it('recognizes the common agent instruction files, any case', () => {
    for (const name of ['AGENTS.md', 'agents.md', 'AGENT.md', 'CLAUDE.md', 'claude.md', 'GEMINI.md',
      'copilot-instructions.md', 'CONVENTIONS.md', 'CLAUDE.local.md', 'AGENTS.override.md']) {
      assert.ok(isAgentInstructionFile(name), name)
    }
  })

  it('recognizes rule files from Cursor, Copilot, Windsurf and Cline', () => {
    for (const name of ['react.mdc', 'Style.MDC', 'tests.instructions.md', '.cursorrules', '.windsurfrules', '.clinerules']) {
      assert.ok(isAgentInstructionFile(name), name)
    }
  })

  it('looks only at the base name of a path', () => {
    assert.ok(isAgentInstructionFile('C:\\repo\\.github\\copilot-instructions.md'))
    assert.ok(isAgentInstructionFile('/home/me/repo/CLAUDE.md'))
    assert.ok(!isAgentInstructionFile('/home/AGENTS.md/notes.md'))
  })

  it('ignores ordinary documents', () => {
    for (const name of ['README.md', 'agents-notes.md', 'my-claude.md', 'CLAUDE.txt', 'conventions.mdx', '']) {
      assert.ok(!isAgentInstructionFile(name), name)
    }
  })
})

describe('addedPaths', () => {
  it('returns new paths in `after` order', () => {
    assert.deepEqual(addedPaths(['/a', '/b'], ['/c', '/a', '/d', '/b']), ['/c', '/d'])
  })

  it('works with any iterables and empty input', () => {
    assert.deepEqual(addedPaths(new Set<string>(), new Set(['/x'])), ['/x'])
    assert.deepEqual(addedPaths(['/x'], []), [])
  })
})

describe('titleFromMarkdown', () => {
  it('returns null for an empty or blank document', () => {
    assert.equal(titleFromMarkdown(''), null)
    assert.equal(titleFromMarkdown('  \n\n\t\n'), null)
  })

  it('uses the first heading, wherever it is', () => {
    assert.equal(titleFromMarkdown('Here is your plan:\n\n# Launch plan\n\nText'), 'Launch plan')
    assert.equal(titleFromMarkdown('### Deep heading ###'), 'Deep heading')
  })

  it('reads setext and HTML headings', () => {
    assert.equal(titleFromMarkdown('Big title\n=========\n\nBody'), 'Big title')
    assert.equal(titleFromMarkdown('Sub title\n---\n'), 'Sub title')
    assert.equal(titleFromMarkdown('<h1 align="center">SimpleMD</h1>\n\ntext'), 'SimpleMD')
  })

  it('ignores headings inside fenced code', () => {
    assert.equal(titleFromMarkdown('```bash\n# install it\nnpm i\n```\n\n## Real title'), 'Real title')
    assert.equal(titleFromMarkdown('~~~\n# not this\n~~~\nPlain first line'), 'Plain first line')
  })

  it('ignores headings inside a fence opened on a list item or in a quote', () => {
    assert.equal(titleFromMarkdown('Intro paragraph\n- ```\n  # Secret\n  ```\n'), 'Intro paragraph')
    assert.equal(titleFromMarkdown('1. ```md\n   # Secret\n   ```\n\n# Real'), 'Real')
    assert.equal(titleFromMarkdown('> - ```\n>   # Secret\n>   ```\n\n## Real'), 'Real')
  })

  it('ends an unclosed list-item fence at the first line left of the item', () => {
    // Arrange: a streamed answer whose fence never closed; "Para" leaves the list item
    const md = '- ```\n  code\n\nPara after\n# H\n'

    // Act / Assert: fenced code has no lazy continuation, so the heading is real
    assert.equal(titleFromMarkdown(md), 'H')
    assert.equal(suggestFileName(md), 'H.md')
  })

  it('ends an unclosed quoted fence where the quote ends', () => {
    assert.equal(titleFromMarkdown('> ```\n> # Secret\n\n# Real'), 'Real')
    assert.equal(titleFromMarkdown('> ```\n> code\n\nFirst words'), 'First words')
  })

  it('keeps a quoted fence line inside a top-level block as code', () => {
    assert.equal(titleFromMarkdown('```md\n> ```\n# Secret\n```\n\n# Real'), 'Real')
  })

  it('keeps a fence open past an indented fence line inside it', () => {
    // Arrange: the "```" indented 4 columns is code, so "# inside" is still in the block
    const md = '```md\n    ```\n# inside\n```\n\n# Real'

    // Act / Assert
    assert.equal(titleFromMarkdown(md), 'Real')
  })

  it('falls back to the first line with readable words', () => {
    assert.equal(titleFromMarkdown('\n\n---\n\nJust some **bold** words.'), 'Just some bold words.')
    assert.equal(titleFromMarkdown('| Name | Age |\n|---|---|\n| a | 1 |'), 'Name Age')
  })

  it('strips front matter and prefers its title over a plain first line', () => {
    assert.equal(titleFromMarkdown('---\ntitle: "Release notes"\ndate: 2024\n---\nIntro text'), 'Release notes')
    assert.equal(titleFromMarkdown('---\nlayout: post\n---\nIntro text'), 'Intro text')
    assert.equal(titleFromMarkdown('---\ntitle: FM title\n---\n# Heading wins'), 'Heading wins')
    assert.equal(titleFromMarkdown('+++\ntitle = "Hugo page"\n+++\nbody'), 'Hugo page')
  })

  it('strips inline Markdown syntax', () => {
    assert.equal(titleFromMarkdown('# **Bold** _and_ *it* `code` ~~gone~~'), 'Bold and it code gone')
    assert.equal(titleFromMarkdown('# [Link text](https://x.y) and ![alt](a.png)'), 'Link text and alt')
    assert.equal(titleFromMarkdown('# Ref [link][1] and note[^2]'), 'Ref link and note')
    assert.equal(titleFromMarkdown('# Tom &amp; Jerry &lt;3'), 'Tom & Jerry <3')
    assert.equal(titleFromMarkdown('# Escaped \\*stars\\*'), 'Escaped *stars*')
    assert.equal(titleFromMarkdown('# <span>Hi</span> there'), 'Hi there')
  })

  it('keeps Markdown-looking text inside code spans literal', () => {
    assert.equal(titleFromMarkdown('# The `__init__` method'), 'The __init__ method')
    assert.equal(titleFromMarkdown('# Use `a*b*c` here'), 'Use a*b*c here')
    assert.equal(titleFromMarkdown('# Use `[a](b)` syntax'), 'Use [a](b) syntax')
    assert.equal(titleFromMarkdown('# Escapes `\\*` stay and `&amp;` too'), 'Escapes \\* stay and &amp; too')
    assert.equal(suggestFileName('# The `__init__` method'), 'The __init__ method.md')
  })

  it('pairs code spans by run length and strips emphasis around them', () => {
    assert.equal(titleFromMarkdown('# ``a`b`` and **`bold code`**'), 'a`b and bold code')
    assert.equal(titleFromMarkdown('# [`fuzzy.ts`](src/fuzzy.ts) notes'), 'fuzzy.ts notes')
    // An escaped backtick opens nothing, and a run with no partner is text.
    assert.equal(titleFromMarkdown('# a \\`b` c'), 'a `b` c')
    assert.equal(titleFromMarkdown('# lone ` tick'), 'lone ` tick')
  })

  it('keeps pipes inside code spans and escaped pipes in a table row', () => {
    assert.equal(titleFromMarkdown('| `a|b` | c \\| d |\n|---|---|'), 'a|b c | d')
  })

  it('keeps private-use characters such as Nerd Font icons as they are', () => {
    // Arrange: U+E000 and U+E05C sit where the old escape stand-ins lived
    const icons = `${String.fromCharCode(0xe000)} Hello ${String.fromCharCode(0xe05c)} world`

    // Act
    const title = titleFromMarkdown(`# ${icons} \\*`)

    // Assert
    assert.equal(title, `${icons} *`)
  })

  it('keeps the number of a numbered heading', () => {
    assert.equal(titleFromMarkdown('# 1. Introduction'), '1. Introduction')
    assert.equal(titleFromMarkdown('## - dash first'), '- dash first')
    assert.equal(titleFromMarkdown('Step 2) setup\n==='), 'Step 2) setup')
  })

  it('reads a setext heading over a paragraph of several lines', () => {
    assert.equal(titleFromMarkdown('line one\nline two\n===\n\nbody'), 'line one line two')
    assert.equal(titleFromMarkdown('intro\n\nfirst\nsecond\n---'), 'first second')
    assert.equal(titleFromMarkdown('```\ncode\n```\nafter fence\n==='), 'after fence')
  })

  it('skips a callout marker and uses the callout text', () => {
    assert.equal(titleFromMarkdown('> [!NOTE]\n> callout body'), 'callout body')
    assert.equal(titleFromMarkdown('> [!WARNING]- Read this first\n> more'), 'Read this first')
    assert.equal(suggestFileName('> [!TIP]\n> Use the palette'), 'Use the palette.md')
    assert.equal(titleFromMarkdown('[!NOTE] not a callout'), '[!NOTE] not a callout')
  })

  it('keeps underscores inside words', () => {
    assert.equal(titleFromMarkdown('# my_file_name and snake_case'), 'my_file_name and snake_case')
  })

  it('leaves unpaired emphasis markers like *args and **kwargs alone', () => {
    assert.equal(titleFromMarkdown('Use *args and **kwargs here'), 'Use *args and **kwargs here')
    assert.equal(titleFromMarkdown('# Set *ptr = &x first'), 'Set *ptr = &x first')
    assert.equal(titleFromMarkdown('# a ** b and c * d'), 'a ** b and c * d')
  })

  it('reads links whose address holds parentheses', () => {
    assert.equal(titleFromMarkdown('# See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now'), 'See Foo now')
  })

  it('strips nested and triple emphasis', () => {
    assert.equal(titleFromMarkdown('# ***Bold italic*** text'), 'Bold italic text')
    assert.equal(titleFromMarkdown('# **a *b* c** and *d **e** f*'), 'a b c and d e f')
    assert.equal(titleFromMarkdown('# ==marked== and ~~struck~~'), 'marked and struck')
  })

  it('strips quote, list and task markers', () => {
    assert.equal(titleFromMarkdown('> > Quoted line'), 'Quoted line')
    assert.equal(titleFromMarkdown('- [ ] Buy milk'), 'Buy milk')
    assert.equal(titleFromMarkdown('12. Twelfth step'), 'Twelfth step')
  })

  it('collapses whitespace and handles CRLF and a BOM', () => {
    assert.equal(titleFromMarkdown(`${BOM}#   Spaced    out\r\n\r\nbody`), 'Spaced out')
  })

  it('skips HTML comments', () => {
    assert.equal(titleFromMarkdown('<!-- generated -->\n<!--\nmulti\n-->\nActual text'), 'Actual text')
  })

  it('uses code only when the document has nothing else', () => {
    assert.equal(titleFromMarkdown('```js\nconst x = 1\n```'), 'const x = 1')
  })

  it('cuts long titles on a word boundary with an ellipsis', () => {
    // Arrange
    const md = '# The quick brown fox jumps over the lazy dog and keeps running far away'

    // Act
    const t = titleFromMarkdown(md, 30)

    // Assert
    assert.equal(t, 'The quick brown fox jumps…')
    assert.ok([...(t ?? '')].length <= 30)
  })

  it('cuts a single long word hard when there is no good boundary', () => {
    const t = titleFromMarkdown(`# ${'x'.repeat(100)}`, 10)
    assert.equal(t, `${'x'.repeat(9)}…`)
  })

  it('treats a tiny or invalid maxLength sensibly', () => {
    assert.equal(titleFromMarkdown('# Hello world', 1), '…')
    assert.equal(titleFromMarkdown('# Hello world', Number.NaN), 'Hello world')
    assert.equal(titleFromMarkdown('# Hello world', 7.9), 'Hello…')
  })

  it('does not cut a title that fits exactly', () => {
    assert.equal(titleFromMarkdown('# 12345', 5), '12345')
  })

  it('never splits an emoji when cutting', () => {
    const t = titleFromMarkdown(`# ${'😀'.repeat(20)}`, 5) ?? ''
    assert.equal(t, '😀😀😀😀…')
  })

  it('keeps ZWJ emoji sequences and flags whole when cutting', () => {
    // Arrange
    const family = `👨${ZWJ}👩${ZWJ}👧${ZWJ}👦`
    const flag = '🇯🇵'

    // Act
    const families = titleFromMarkdown(`# ${family.repeat(7)}`, 5)
    const flags = titleFromMarkdown(`# ${flag.repeat(60)}`, 48)

    // Assert
    assert.equal(families, `${family.repeat(4)}…`)
    assert.equal(flags, `${flag.repeat(47)}…`)
  })

  it('counts an accented letter written with a combining mark as one character', () => {
    const e = `e${String.fromCharCode(0x301)}`
    assert.equal(titleFromMarkdown(`# ${e.repeat(10)}`, 4), `${e.repeat(3)}…`)
  })

  it('stays fast on pathological input (unclosed comments, links, tags and emphasis)', () => {
    const units = ['<!-- ', '[', '![', '[a](', '<a ', '**x ', '*x ', '_x ', '__x ', '~~x ', '`` ', '<http://x ']
    for (const unit of units) {
      // Arrange: about 100 KB of openers that never close
      const md = unit.repeat(Math.ceil(100_000 / unit.length))

      // Act
      const ms = medianMs(() => {
        titleFromMarkdown(md)
        suggestFileName(md)
      }, 3)

      // Assert
      assert.ok(ms < 500, `${JSON.stringify(unit)} took ${ms.toFixed(1)} ms`)
    }
  })

  it('handles a huge document quickly', () => {
    // Arrange
    const md = `${'Some paragraph text.\n'.repeat(100_000)}# Late heading`

    // Act
    const t = titleFromMarkdown(md)
    const ms = medianMs(() => titleFromMarkdown(md), 3)

    // Assert
    assert.equal(t, 'Late heading')
    assert.ok(ms < 1500, `took ${ms.toFixed(1)} ms`)
  })
})

describe('suggestFileName', () => {
  it('turns the title into a file name', () => {
    assert.equal(suggestFileName('# Launch plan\n\ntext'), 'Launch plan.md')
  })

  it('falls back to Untitled.md', () => {
    assert.equal(suggestFileName(''), 'Untitled.md')
    assert.equal(suggestFileName('***\n\n---\n'), 'Untitled.md')
    assert.equal(suggestFileName('# ???'), 'Untitled.md')
  })

  it('replaces characters that are unsafe on any OS', () => {
    assert.equal(suggestFileName('# Plan: Q3 / Q4 <draft> "v2"?'), 'Plan Q3 Q4 v2.md')
    assert.equal(suggestFileName('# a\\b|c*d'), 'a b c d.md')
  })

  it('drops leading dots and trailing dots or spaces', () => {
    assert.equal(suggestFileName('# ...hidden thought...'), 'hidden thought.md')
  })

  it('keeps a Markdown extension already in the title', () => {
    assert.equal(suggestFileName('# README.md'), 'README.md')
  })

  it('avoids Windows device names', () => {
    assert.equal(suggestFileName('# CON'), 'CON (1).md')
    assert.equal(suggestFileName('# nul.md'), 'nul (1).md')
  })

  it('cuts long titles on a word boundary without an ellipsis', () => {
    // Arrange
    const md = `# ${'word '.repeat(40)}`

    // Act
    const name = suggestFileName(md)

    // Assert
    assert.ok(!name.includes('…'))
    assert.ok(name.length <= 63, name)
    assert.match(name, /^word( word)*\.md$/)
  })

  it('shortens a long title in a script with many-byte characters to fit 255 bytes', () => {
    // Arrange: 60 characters of these are well over the 255-byte name limit
    const titles = ['क्षत्रिय '.repeat(12), '👍🏽 '.repeat(40), `${'क्षत्रिय'.repeat(30)}`]
    for (const title of titles) {
      // Act
      const name = suggestFileName(`# ${title}`)

      // Assert: a real, shortened name, cut between words (or characters) of the title
      assert.notEqual(name, 'Untitled.md', title)
      assert.ok(new TextEncoder().encode(name).length <= 255, name)
      assert.ok(title.startsWith(name.slice(0, -'.md'.length)), name)
      assert.equal(validateFileName(name, 'linux'), null, name)
    }
  })

  it('keeps room for the device-name suffix in a byte-cut name', () => {
    // Arrange: "aux." gets " (1)" after the title is cut to the byte limit
    const md = `# aux.${'👍🏽'.repeat(40)}`

    // Act
    const name = suggestFileName(md)

    // Assert
    assert.notEqual(name, 'Untitled.md')
    assert.ok(name.startsWith('aux (1).👍🏽'), name)
    assert.ok(new TextEncoder().encode(name).length <= 255, name)
    assert.equal(validateFileName(name, 'win32'), null, name)
  })

  it('cuts a many-byte title on a word boundary', () => {
    const name = suggestFileName(`# ${'क्षत्रिय '.repeat(12)}`)
    assert.match(name, /^क्षत्रिय( क्षत्रिय)*\.md$/)
  })

  it('drops invisible and text-direction characters from pasted titles', () => {
    assert.equal(suggestFileName(`# Plan${ZWSP} for${String.fromCharCode(0x202e)} Q3${BOM}`), 'Plan for Q3.md')
    assert.equal(suggestFileName(`# ${ZWSP}${ZWJ}${WORD_JOINER}`), 'Untitled.md')
    assert.equal(suggestFileName(`# Team 👨${ZWJ}👩${ZWJ}👧`), `Team 👨${ZWJ}👩${ZWJ}👧.md`)
  })

  it('always produces a name that validates on every platform', () => {
    const samples = [
      '# Ünïcödé 😀 notes', '# a.', '#  . ', '# x'.repeat(50), '# COM3.txt', '# tab\there', '#   ',
      `# ${ZWSP}`, `# a${String.fromCharCode(0x2066)}b`, `# ${`👨${ZWJ}👩${ZWJ}👧`.repeat(30)}`
    ]
    for (const md of samples) {
      const name = suggestFileName(md)
      for (const platform of ['win32', 'darwin', 'linux'] as const) {
        assert.equal(validateFileName(name, platform), null, `${JSON.stringify(md)} → ${name}`)
      }
    }
  })
})

describe('normalizePastedMarkdown', () => {
  it('normalizes line endings and trims blank lines at both ends', () => {
    assert.equal(normalizePastedMarkdown('\r\n\r\n# Title\r\n\r\nText\r\n\r\n\r\n'), '# Title\n\nText\n')
  })

  it('keeps indentation of the first line and trailing hard-break spaces', () => {
    assert.equal(normalizePastedMarkdown('\n    indented code\nline with break  \nnext'), '    indented code\nline with break  \nnext\n')
  })

  it('returns "" for empty or blank input', () => {
    assert.equal(normalizePastedMarkdown(''), '')
    assert.equal(normalizePastedMarkdown(' \n\t\n'), '')
  })

  it('removes zero-width characters and a BOM outside code', () => {
    assert.equal(normalizePastedMarkdown(`${BOM}Hello${ZWSP} wor${WORD_JOINER}ld`), 'Hello world\n')
  })

  it('turns non-breaking spaces into spaces outside code', () => {
    assert.equal(normalizePastedMarkdown(`a${NBSP}b${NNBSP}c`), 'a b c\n')
  })

  it('removes stray joiners but keeps emoji sequences and joining scripts intact', () => {
    // Arrange
    const family = `👨${ZWJ}👩${ZWJ}👧`
    const persian = `می${ZWNJ}خواهم`

    // Act
    const out = normalizePastedMarkdown(`word${ZWJ} ${family} ${persian} x${ZWNJ}y`)

    // Assert
    assert.equal(out, `word ${family} ${persian} xy\n`)
  })

  it('leaves inline code spans untouched', () => {
    const line = `a${NBSP}b \`x${NBSP}y${ZWSP}\` c${ZWSP}d`
    assert.equal(normalizePastedMarkdown(line), `a b \`x${NBSP}y${ZWSP}\` cd\n`)
  })

  it('leaves fenced code untouched', () => {
    // Arrange
    const code = `\`\`\`py\nx${NBSP}=${ZWSP}1  \n\n\`\`\`\nafter${NBSP}`

    // Act / Assert
    assert.equal(normalizePastedMarkdown(code), `\`\`\`py\nx${NBSP}=${ZWSP}1  \n\n\`\`\`\nafter \n`)
  })

  it('leaves indented code blocks untouched', () => {
    // Arrange
    const code = `text\n\n    indented${ZWSP}code\n\tx${NBSP}y\n\n    more${NBSP}\nafter${NBSP}`

    // Act
    const out = normalizePastedMarkdown(code)

    // Assert
    assert.equal(out, `text\n\n    indented${ZWSP}code\n\tx${NBSP}y\n\n    more${NBSP}\nafter \n`)
  })

  it('cleans an indented line that continues a paragraph or a list item', () => {
    assert.equal(normalizePastedMarkdown(`para\n    lazy${NBSP}line`), 'para\n    lazy line\n')
    assert.equal(normalizePastedMarkdown(`- item\n\n    more${NBSP}text`), '- item\n\n    more text\n')
    assert.equal(normalizePastedMarkdown(`1. step\n\n    - sub${NBSP}item`), '1. step\n\n    - sub item\n')
  })

  it('treats text indented 4 past a list item as code', () => {
    const md = `- item\n\n      code${NBSP}here`
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('ends a list at text back on the margin after a blank line', () => {
    const md = `- item\n\npara\n\n    code${NBSP}`
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('leaves <pre>, <script> and multi-line <code> blocks untouched', () => {
    // Arrange
    const pre = `<pre>\nx${NBSP}y${ZWSP}\n</pre>\nafter${NBSP}`
    const oneLine = `<pre>a${NBSP}b</pre>`
    const code = `<code>\nz${NBSP}\n</code>`

    // Act / Assert
    assert.equal(normalizePastedMarkdown(pre), `<pre>\nx${NBSP}y${ZWSP}\n</pre>\nafter \n`)
    assert.equal(normalizePastedMarkdown(oneLine), `${oneLine}\n`)
    assert.equal(normalizePastedMarkdown(code), `${code}\n`)
  })

  it('leaves inline <code> elements untouched but cleans the text around them', () => {
    const line = `a${NBSP}<code>x${NBSP}y</code>${NBSP}b <code class="k">p${ZWSP}</code>`
    assert.equal(normalizePastedMarkdown(line), `a <code>x${NBSP}y</code> b <code class="k">p${ZWSP}</code>\n`)
    assert.equal(normalizePastedMarkdown(`<code>open${NBSP} only`), `<code>open${NBSP} only\n`)
  })

  it('never takes copy-looking lines out of indented code above a fence', () => {
    const md = 'Text\n\n    copy\n```\nx\n```'
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('treats a 4-space indented fence as indented code', () => {
    const md = `Text\n\n    \`\`\`\n    a${NBSP}\n    \`\`\`\nafter${NBSP}`
    assert.equal(normalizePastedMarkdown(md), `Text\n\n    \`\`\`\n    a${NBSP}\n    \`\`\`\nafter \n`)
  })

  it('removes "Copy code" residue directly above a fence', () => {
    assert.equal(normalizePastedMarkdown('Run this:\n\nCopy code\n```bash\nnpm i\n```'), 'Run this:\n\n```bash\nnpm i\n```\n')
  })

  it('removes the language label and button row that chat UIs put above code', () => {
    const pasted = 'Steps:\n\npython\nCopy\nEdit\n```python\nprint(1)\n```\n'
    assert.equal(normalizePastedMarkdown(pasted), 'Steps:\n\n```python\nprint(1)\n```\n')
  })

  it('removes "Copied!" and "Copy to clipboard" labels too', () => {
    assert.equal(normalizePastedMarkdown('Copied!\n```\nx\n```'), '```\nx\n```\n')
    assert.equal(normalizePastedMarkdown('copy to clipboard\n~~~\nx\n~~~'), '~~~\nx\n~~~\n')
  })

  it('never removes copy-looking lines inside a fence, which may be real code', () => {
    for (const md of ['```\ncopy\n```', '```\nCOPY\nx\n```', '```js\nCopy code\nlet a = 1\n```', '```bat\ncopy\ncopy a.txt b.txt\n```']) {
      assert.equal(normalizePastedMarkdown(md), `${md}\n`, md)
    }
  })

  it('keeps words like "Edit" or a language name when no Copy label is there', () => {
    assert.equal(normalizePastedMarkdown('Edit\n```\nx\n```'), 'Edit\n```\nx\n```\n')
    assert.equal(normalizePastedMarkdown('python\n```python\nx\n```'), 'python\n```python\nx\n```\n')
  })

  it('keeps "Copy" when it is not directly above a fence', () => {
    assert.equal(normalizePastedMarkdown('Copy\n\nThen paste it.'), 'Copy\n\nThen paste it.\n')
  })

  it('keeps residue-looking lines inside code after the first line', () => {
    assert.equal(normalizePastedMarkdown('```\nfirst\nCopy\n```'), '```\nfirst\nCopy\n```\n')
  })

  it('treats a fence inside a list item or quote as code', () => {
    const md = `1. Install:\n   \`\`\`sh\n   npm${NBSP}i\n   \`\`\`\n> \`\`\`\n> a${NBSP}b\n> \`\`\``
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('treats a fence opened on a list item line as code', () => {
    // Arrange: "- ```bat" opens a block whose "copy" line is a real command
    const md = `- \`\`\`bat\n  copy\n  \`\`\`\n\nText${NBSP}here\n\n\`\`\`\ncode${NBSP}x${ZWSP}\n\`\`\``

    // Act
    const out = normalizePastedMarkdown(md)

    // Assert: both blocks kept byte for byte, the prose between them cleaned
    assert.equal(out, `- \`\`\`bat\n  copy\n  \`\`\`\n\nText here\n\n\`\`\`\ncode${NBSP}x${ZWSP}\n\`\`\`\n`)
  })

  it('keeps no-break spaces inside a fence on a numbered or quoted list item', () => {
    for (const md of [`1. \`\`\`bash\n   echo${NBSP}hi\n   \`\`\``, `> - ~~~\n>   a${NBSP}b\n>   ~~~`, `- a\n  - \`\`\`\n    x${NBSP}\n    \`\`\``]) {
      assert.equal(normalizePastedMarkdown(md), `${md}\n`, md)
    }
  })

  it('cleans prose after an unclosed list-item fence', () => {
    // Arrange: the fence never closes, but "Para" and "- next" leave its list item
    const md = `- \`\`\`\n  code${NBSP}\n\nPara${NBSP}after\n- \`\`\`\n  x${NBSP}\n- next${NBSP}item`

    // Act / Assert: code keeps its no-break spaces, the prose loses them
    assert.equal(normalizePastedMarkdown(md), `- \`\`\`\n  code${NBSP}\n\nPara after\n- \`\`\`\n  x${NBSP}\n- next item\n`)
  })

  it('cleans prose after an unclosed quoted fence once the quote ends', () => {
    const md = `> \`\`\`\n> a${NBSP}b\n\nc${NBSP}d`
    assert.equal(normalizePastedMarkdown(md), `> \`\`\`\n> a${NBSP}b\n\nc d\n`)
  })

  it('keeps a quoted fence line inside a top-level block as code', () => {
    // Arrange: the "> ```" shows a quoted fence; it doesn't close the ```md block
    const md = `\`\`\`md\n> \`\`\`\nstill${NBSP}code\n\`\`\`\nafter${NBSP}`

    // Act / Assert
    assert.equal(normalizePastedMarkdown(md), `\`\`\`md\n> \`\`\`\nstill${NBSP}code\n\`\`\`\nafter \n`)
  })

  it('reads indented code after a quoted fence ends', () => {
    // Arrange: a line indented 4 after the quote is an indented code block
    const md = `> \`\`\`\n> a\n\n    keep${NBSP}me`

    // Act / Assert
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('continues the list after a fence on a list item closes', () => {
    // Arrange: text at the item's indent continues the item, so it is not indented code
    const md = `- \`\`\`sh\n  x\n  \`\`\`\n\n  more${NBSP}text`

    // Act / Assert
    assert.equal(normalizePastedMarkdown(md), `- \`\`\`sh\n  x\n  \`\`\`\n\n  more text\n`)
  })

  it('does not close a fence at a fence line indented 4 or more columns', () => {
    // Arrange: the indented ``` is part of the Python string, not the end of the block
    const md = `\`\`\`python\ndoc = """\n    \`\`\`\n"""\nx = "a${NBSP}b"\n\`\`\`\nafter${NBSP}`

    // Act / Assert
    assert.equal(normalizePastedMarkdown(md), `\`\`\`python\ndoc = """\n    \`\`\`\n"""\nx = "a${NBSP}b"\n\`\`\`\nafter \n`)
  })

  it('closes a fence indented up to 3 columns past its container', () => {
    const md = `\`\`\`\na${NBSP}\n   \`\`\`\nb${NBSP}\n- \`\`\`\n  c${NBSP}\n     \`\`\`\nd${NBSP}`
    assert.equal(normalizePastedMarkdown(md), `\`\`\`\na${NBSP}\n   \`\`\`\nb \n- \`\`\`\n  c${NBSP}\n     \`\`\`\nd \n`)
  })

  it('stays fast on a line of thousands of list and quote markers', () => {
    // Arrange: markers with runs of spaces, which a backtracking regex would explode on
    const line = `${'-    >   1.   '.repeat(5000)}x`

    // Act
    const ms = medianMs(() => normalizePastedMarkdown(`${line}\n${line}`))

    // Assert
    assert.ok(ms < 300, `took ${ms.toFixed(1)} ms`)
  })

  it('needs a matching fence to close a block', () => {
    const md = `\`\`\`\`md\n\`\`\`\ninner${NBSP}\n\`\`\`\n\`\`\`\`\nout${NBSP}`
    assert.equal(normalizePastedMarkdown(md), `\`\`\`\`md\n\`\`\`\ninner${NBSP}\n\`\`\`\n\`\`\`\`\nout \n`)
  })

  it('leaves an unclosed fence (and everything after it) unchanged', () => {
    const md = `text\n\`\`\`\ncode${NBSP}\nmore${ZWSP}`
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('pairs inline code runs by length, leaving unmatched runs as text', () => {
    // Arrange: `a` and ``b`c`` are spans; the last ` has no partner, so it is text
    const md = `x${NBSP}\`a${NBSP}\`y \`\`b${NBSP}\`c\`\` z${NBSP}\` lone${NBSP}end`

    // Act
    const out = normalizePastedMarkdown(md)

    // Assert
    assert.equal(out, `x \`a${NBSP}\`y \`\`b${NBSP}\`c\`\` z \` lone end\n`)
  })

  it('stays fast on a line with thousands of unmatched backtick runs', () => {
    // Arrange: 40,000 runs of growing length, none of which closes another
    const line = Array.from({ length: 40_000 }, (_, i) => `${'`'.repeat((i % 200) + 1)}x`).join(' ')

    // Act
    const ms = medianMs(() => normalizePastedMarkdown(line))

    // Assert
    assert.ok(ms < 300, `took ${ms.toFixed(1)} ms`)
  })

  it('handles a large paste quickly', () => {
    // Arrange
    const block = `Line with${NBSP}nbsp and ${ZWSP}zero width.\n\`\`\`js\ncode()\n\`\`\`\n`
    const text = block.repeat(20_000)

    // Act
    const out = normalizePastedMarkdown(text)
    const ms = medianMs(() => normalizePastedMarkdown(text), 3)

    // Assert
    assert.ok(!out.includes(NBSP))
    assert.ok(ms < 1500, `took ${ms.toFixed(1)} ms`)
  })
})
