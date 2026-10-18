import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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

  it('keeps underscores inside words', () => {
    assert.equal(titleFromMarkdown('# my_file_name and snake_case'), 'my_file_name and snake_case')
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

  it('handles a huge document quickly', () => {
    // Arrange
    const md = `${'Some paragraph text.\n'.repeat(100_000)}# Late heading`

    // Act
    const started = performance.now()
    const t = titleFromMarkdown(md)
    const elapsed = performance.now() - started

    // Assert
    assert.equal(t, 'Late heading')
    assert.ok(elapsed < 1500, `took ${elapsed.toFixed(1)} ms`)
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

  it('always produces a name that validates on every platform', () => {
    const samples = ['# Ünïcödé 😀 notes', '# a.', '#  . ', '# x'.repeat(50), '# COM3.txt', '# tab\there', '#   ']
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

  it('removes copy residue as the first line inside a fence', () => {
    assert.equal(normalizePastedMarkdown('```js\nCopy code\nlet a = 1\n```'), '```js\nlet a = 1\n```\n')
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

  it('needs a matching fence to close a block', () => {
    const md = `\`\`\`\`md\n\`\`\`\ninner${NBSP}\n\`\`\`\n\`\`\`\`\nout${NBSP}`
    assert.equal(normalizePastedMarkdown(md), `\`\`\`\`md\n\`\`\`\ninner${NBSP}\n\`\`\`\n\`\`\`\`\nout \n`)
  })

  it('leaves an unclosed fence (and everything after it) unchanged', () => {
    const md = `text\n\`\`\`\ncode${NBSP}\nmore${ZWSP}`
    assert.equal(normalizePastedMarkdown(md), `${md}\n`)
  })

  it('handles a large paste quickly', () => {
    // Arrange
    const block = `Line with${NBSP}nbsp and ${ZWSP}zero width.\n\`\`\`js\ncode()\n\`\`\`\n`
    const text = block.repeat(20_000)

    // Act
    const started = performance.now()
    const out = normalizePastedMarkdown(text)
    const elapsed = performance.now() - started

    // Assert
    assert.ok(!out.includes(NBSP))
    assert.ok(elapsed < 1500, `took ${elapsed.toFixed(1)} ms`)
  })
})
