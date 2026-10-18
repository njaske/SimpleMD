import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, it } from 'node:test'
import type { FormatEdit, TextState } from '../src/renderer/src/lib/editor/format.ts'
import type { FormatCommand } from '../src/renderer/src/lib/editor/types.ts'

// The transforms import each other without extensions (Vite style); node needs the ".ts",
// so resolve those before loading the module under test.
registerHooks({
  resolve(specifier, context, next) {
    const extensionless = /^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)
    return next(extensionless && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context)
  }
})
const { applyEdit, applyFormat, indentList, insertBlockText, isUrl, mapPos, pasteUrlOverSelection } = await import(
  '../src/renderer/src/lib/editor/format.ts'
)

// Cases are written with the selection inline: "‹" marks where it starts and "›" where it
// ends; a lone "¦" is a cursor.
function parse(marked: string): TextState {
  const cursor = marked.indexOf('¦')
  if (cursor >= 0) return { text: marked.replace('¦', ''), selection: { from: cursor, to: cursor } }
  const from = marked.indexOf('‹')
  const to = marked.indexOf('›') - 1
  return { text: marked.replace('‹', '').replace('›', ''), selection: { from, to } }
}

function show(text: string, edit: FormatEdit): string {
  const out = applyEdit(text, edit)
  const { anchor, head } = edit.selection
  const [from, to] = [Math.min(anchor, head), Math.max(anchor, head)]
  if (from === to) return out.slice(0, from) + '¦' + out.slice(from)
  return out.slice(0, from) + '‹' + out.slice(from, to) + '›' + out.slice(to)
}

function fmt(marked: string, cmd: FormatCommand, clipboard?: string): string {
  const state = parse(marked)
  const edit = applyFormat(cmd, state, { clipboard })
  assert.ok(edit, `expected an edit for ${cmd}`)
  return show(state.text, edit)
}

describe('inline marks', () => {
  it('wraps a selection in bold and keeps the text selected', () => {
    assert.equal(fmt('make ‹this› bold', 'bold'), 'make **‹this›** bold')
  })

  it('unwraps bold when the selection includes the markers', () => {
    assert.equal(fmt('make ‹**this**› plain', 'bold'), 'make ‹this› plain')
  })

  it('unwraps bold when the markers sit just outside the selection', () => {
    assert.equal(fmt('make **‹this›** plain', 'bold'), 'make ‹this› plain')
  })

  it('toggles the word under the cursor on and off', () => {
    const on = fmt('a wo¦rd here', 'italic')
    assert.equal(on, 'a *wo¦rd* here')
    assert.equal(fmt(on, 'italic'), 'a wo¦rd here')
  })

  it('keeps the cursor inside the markers when it sits at the end of the word', () => {
    assert.equal(fmt('word¦ next', 'bold'), '**word¦** next')
  })

  it('inserts an empty pair with the cursor between when there is no word', () => {
    assert.equal(fmt('end ¦', 'bold'), 'end **¦**')
    assert.equal(fmt('end **¦**', 'bold'), 'end ¦')
  })

  it('tells bold and italic apart in a *** run', () => {
    assert.equal(fmt('‹***both***›', 'italic'), '‹**both**›')
    assert.equal(fmt('‹***both***›', 'bold'), '‹*both*›')
    assert.equal(fmt('‹**bold**›', 'italic'), '*‹**bold**›*')
  })

  it('recognises underscore emphasis but not intraword underscores', () => {
    assert.equal(fmt('_‹word›_', 'italic'), '‹word›')
    assert.equal(fmt('snake_‹case›_name', 'italic'), 'snake_*‹case›*_name')
  })

  it('trims spaces out of the wrapped range', () => {
    assert.equal(fmt('a‹ spaced ›b', 'bold'), 'a‹ **spaced** ›b')
  })

  it('wraps each line of a multi-line selection, skipping list markers', () => {
    const struck = fmt('- ‹one\n- two›', 'strikethrough')
    assert.equal(struck, '- ‹~~one~~\n- ~~two~~›')
    assert.equal(fmt(struck, 'strikethrough'), '- ‹one\n- two›')
  })

  it('unwraps every line when all of them are already marked', () => {
    assert.equal(fmt('‹**one**\n**two**›', 'bold'), '‹one\ntwo›')
  })

  it('wraps only the unmarked lines in a mixed selection', () => {
    assert.equal(fmt('‹**one**\ntwo›', 'bold'), '‹**one**\n**two**›')
  })

  it('uses a longer fence for inline code that contains backticks', () => {
    assert.equal(fmt('‹a `b` c›', 'code'), '``‹a `b` c›``')
    assert.equal(fmt('‹`x›', 'code'), '`` ‹`x› ``')
  })

  it('turns multi-line inline code into a fenced block', () => {
    assert.equal(fmt('‹one\ntwo›', 'code'), '```\n‹one\ntwo›\n```')
  })

  it('returns null for a selection of only whitespace', () => {
    assert.equal(applyFormat('bold', parse('a‹   ›b')), null)
  })
})

describe('headings', () => {
  it('adds, replaces and removes heading levels', () => {
    assert.equal(fmt('Tit¦le', 'heading1'), '# Tit¦le')
    assert.equal(fmt('# Tit¦le', 'heading2'), '## Tit¦le')
    assert.equal(fmt('## Tit¦le', 'heading2'), 'Tit¦le')
  })

  it('turns headings into paragraphs', () => {
    assert.equal(fmt('### Ti¦tle', 'paragraph'), 'Ti¦tle')
    assert.equal(fmt('plain¦', 'paragraph'), 'plain¦')
  })

  it('puts the cursor after the marker on an empty line', () => {
    assert.equal(fmt('¦', 'heading3'), '### ¦')
  })

  it('replaces a list marker and keeps quote prefixes', () => {
    assert.equal(fmt('- ite¦m', 'heading2'), '## ite¦m')
    assert.equal(fmt('> quo¦ted', 'heading1'), '> # quo¦ted')
  })

  it('applies to every non-blank line of a selection', () => {
    assert.equal(fmt('‹one\n\ntwo›', 'heading1'), '# ‹one\n\n# two›')
  })
})

describe('quotes', () => {
  it('quotes and unquotes lines', () => {
    assert.equal(fmt('sa¦y', 'quote'), '> sa¦y')
    assert.equal(fmt('> sa¦y', 'quote'), 'sa¦y')
  })

  it('keeps blank lines inside a multi-line quote', () => {
    assert.equal(fmt('‹one\n\ntwo›', 'quote'), '> ‹one\n>\n> two›')
    assert.equal(fmt('‹> one\n>\n> two›', 'quote'), '‹one\n\ntwo›')
  })

  it('quotes only the unquoted lines of a mixed selection', () => {
    assert.equal(fmt('‹> one\ntwo›', 'quote'), '‹> one\n> two›')
  })
})

describe('lists', () => {
  it('creates and removes bullets', () => {
    assert.equal(fmt('ite¦m', 'bulletList'), '- ite¦m')
    assert.equal(fmt('- ite¦m', 'bulletList'), 'ite¦m')
  })

  it('starts an empty item on a blank line', () => {
    assert.equal(fmt('¦', 'taskList'), '- [ ] ¦')
  })

  it('numbers a selection of lines', () => {
    assert.equal(fmt('‹a\nb\nc›', 'numberedList'), '1. ‹a\n2. b\n3. c›')
  })

  it('converts between list kinds in place', () => {
    assert.equal(fmt('‹- a\n- b›', 'numberedList'), '1. ‹a\n2. b›')
    assert.equal(fmt('‹1. a\n2. b›', 'bulletList'), '- ‹a\n- b›')
    assert.equal(fmt('* ‹a\n* b›', 'taskList'), '* [ ] ‹a\n* [ ] b›')
    assert.equal(fmt('- [x] ‹done\n- [ ] todo›', 'bulletList'), '- ‹done\n- todo›')
  })

  it('keeps a checked box when converting a mixed selection to tasks', () => {
    assert.equal(fmt('- [x] ‹done\n- todo›', 'taskList'), '- [x] ‹done\n- [ ] todo›')
  })

  it('removes markers from a list that is already the requested kind', () => {
    assert.equal(fmt('‹1. a\n2. b›', 'numberedList'), '‹a\nb›')
  })

  it('renumbers the rest of the list after converting an item', () => {
    assert.equal(fmt('1. a\n- b¦\n2. c\n3. d', 'numberedList'), '1. a\n2. b¦\n3. c\n4. d')
  })

  it('continues numbering across a loose list and restarts nested levels', () => {
    const out = fmt('1. a\n\n‹b›\n   1. x\n   3. y\n5. c', 'numberedList')
    assert.equal(out, '1. a\n\n2. ‹b›\n   1. x\n   2. y\n3. c')
  })

  it('keeps list indentation and quotes', () => {
    assert.equal(fmt('> - ‹a\n>   - b›', 'numberedList'), '> 1. ‹a\n>   1. b›')
  })

  it('strips a heading when making it a list item', () => {
    assert.equal(fmt('## Ti¦tle', 'bulletList'), '- Ti¦tle')
  })
})

describe('indenting list items', () => {
  const tab = (marked: string, dir: 1 | -1): string | null => {
    const state = parse(marked)
    const edit = indentList(state, dir)
    return edit ? show(state.text, edit) : null
  }

  it('nests an item under its previous sibling', () => {
    assert.equal(tab('- a\n- b¦', 1), '- a\n  - b¦')
    assert.equal(tab('1. a\n2. b¦', 1), '1. a\n   1. b¦')
  })

  it('moves an item out to its parent level', () => {
    assert.equal(tab('- a\n  - b¦', -1), '- a\n- b¦')
    assert.equal(tab('1. a\n   1. b¦\n2. c', -1), '1. a\n2. b¦\n3. c')
  })

  it('renumbers the remaining siblings after nesting one', () => {
    assert.equal(tab('1. a\n2. b¦\n3. c', 1), '1. a\n   1. b¦\n2. c')
  })

  it('indents several selected items together', () => {
    assert.equal(tab('- a\n- ‹b\n- c›', 1), '- a\n  - ‹b\n  - c›')
  })

  it('leaves a top-level item alone on Shift+Tab', () => {
    assert.equal(tab('- a¦', -1), '- a¦')
  })

  it('returns null outside lists so Tab can indent normally', () => {
    assert.equal(tab('plain¦', 1), null)
  })
})

describe('blocks', () => {
  it('inserts an empty code block with the cursor inside', () => {
    assert.equal(fmt('¦', 'codeBlock'), '```\n¦\n```')
  })

  it('wraps the touched lines in a fence and toggles it back off', () => {
    const wrapped = fmt('‹one\ntwo›', 'codeBlock')
    assert.equal(wrapped, '```\n‹one\ntwo›\n```')
    assert.equal(fmt('```\non¦e\n```', 'codeBlock'), 'on¦e')
  })

  it('wraps the cursor line and picks a longer fence when needed', () => {
    assert.equal(fmt('co¦de', 'codeBlock'), '```\nco¦de\n```')
    assert.equal(fmt('‹a\n```›', 'codeBlock'), '````\n‹a\n```›\n````')
  })

  it('removes the fences when a whole block is selected', () => {
    assert.equal(fmt('‹```js\nx\n```›\nafter', 'codeBlock'), '‹x›\nafter')
  })

  it('removes an empty fenced block entirely', () => {
    assert.equal(fmt('```\n¦\n```', 'codeBlock'), '¦')
  })

  it('inserts a table after the current paragraph with the first header selected', () => {
    assert.equal(
      fmt('Intro¦\nstill intro\n\nnext', 'table'),
      'Intro\nstill intro\n\n| ‹Column 1› | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n|          |          |          |\n\nnext'
    )
  })

  it('never splits a table when inserting from inside it', () => {
    assert.equal(fmt('| a |\n| -¦ |\n| b |', 'divider'), '| a |\n| - |\n| b |\n\n---\n¦')
  })

  it('separates the block from a following paragraph on a blank line', () => {
    assert.equal(fmt('¦\nnext', 'divider'), '---\n¦\n\nnext')
  })

  it('reuses a blank line for a divider and puts the cursor below it', () => {
    assert.equal(fmt('para\n¦', 'divider'), 'para\n\n---\n¦')
    assert.equal(fmt('¦', 'divider'), '---\n¦')
  })

  it('inserts pasted block text with the cursor after it', () => {
    const state = parse('text¦')
    assert.equal(show(state.text, insertBlockText(state, '| a |\n| - |')), 'text\n\n| a |\n| - |¦')
  })
})

describe('links and images', () => {
  it('wraps the selection and selects the url placeholder', () => {
    assert.equal(fmt('see ‹docs›', 'link'), 'see [docs](‹url›)')
  })

  it('links the word at the cursor', () => {
    assert.equal(fmt('see do¦cs', 'link'), 'see [docs](‹url›)')
  })

  it('uses a selected URL as the target and puts the cursor in the brackets', () => {
    assert.equal(fmt('‹https://a.dev›', 'link'), '[¦](https://a.dev)')
    assert.equal(fmt('‹www.a.dev›', 'link'), '[¦](https://www.a.dev)')
  })

  it('uses a copied URL as the target', () => {
    assert.equal(fmt('‹docs›', 'link', 'https://a.dev'), '[docs](https://a.dev)¦')
    assert.equal(fmt('¦', 'link', ' https://a.dev\n'), '[¦](https://a.dev)')
  })

  it('ignores clipboard text that is not a URL', () => {
    assert.equal(fmt('¦', 'link', 'hello world'), '[](‹url›)')
  })

  it('turns a selected link back into its text', () => {
    assert.equal(fmt('‹[docs](https://a.dev)›', 'link'), '‹docs›')
  })

  it('inserts images with the same rules', () => {
    assert.equal(fmt('‹diagram›', 'image'), '![diagram](‹url›)')
    assert.equal(fmt('‹https://a.dev/x.png›', 'image'), '![¦](https://a.dev/x.png)')
  })
})

describe('pasteUrlOverSelection', () => {
  it('links the selected text to a pasted URL', () => {
    const state = parse('read ‹the docs› now')
    const edit = pasteUrlOverSelection(state, 'https://a.dev/docs')
    assert.ok(edit)
    assert.equal(show(state.text, edit), 'read [the docs](https://a.dev/docs)¦ now')
  })

  it('does nothing without a selection, for non-URLs, multi-line or URL selections', () => {
    assert.equal(pasteUrlOverSelection(parse('a¦'), 'https://a.dev'), null)
    assert.equal(pasteUrlOverSelection(parse('‹a›'), 'not a url'), null)
    assert.equal(pasteUrlOverSelection(parse('‹a\nb›'), 'https://a.dev'), null)
    assert.equal(pasteUrlOverSelection(parse('‹https://x.dev›'), 'https://a.dev'), null)
  })
})

describe('helpers', () => {
  it('detects URLs', () => {
    assert.equal(isUrl('https://example.com/a?b=c'), true)
    assert.equal(isUrl('mailto:me@example.com'), true)
    assert.equal(isUrl('example.com'), false)
    assert.equal(isUrl('https://a.dev and more'), false)
  })

  it('maps positions around insertions according to assoc', () => {
    const changes = [{ from: 2, to: 2, insert: 'xx' }]
    assert.equal(mapPos(changes, 2, -1), 2)
    assert.equal(mapPos(changes, 2, 1), 4)
    assert.equal(mapPos(changes, 5, 1), 7)
  })

  it('maps positions inside a replaced range to its edges', () => {
    const changes = [{ from: 0, to: 3, insert: '- ' }]
    assert.equal(mapPos(changes, 1, -1), 0)
    assert.equal(mapPos(changes, 1, 1), 2)
    assert.equal(mapPos(changes, 3, -1), 2)
  })
})

describe('inline marks inside a marked phrase', () => {
  it('takes bold off the whole phrase from the first, middle or last word', () => {
    assert.equal(fmt('say **he¦llo big world** now', 'bold'), 'say he¦llo big world now')
    assert.equal(fmt('say **hello b¦ig world** now', 'bold'), 'say hello b¦ig world now')
    assert.equal(fmt('say **hello big wor¦ld** now', 'bold'), 'say hello big wor¦ld now')
  })

  it('takes italic, strikethrough and inline code off the whole phrase', () => {
    assert.equal(fmt('a *bb c¦c* d', 'italic'), 'a bb c¦c d')
    assert.equal(fmt('a ~~bb c¦c~~ d', 'strikethrough'), 'a bb c¦c d')
    assert.equal(fmt('x `foo b¦ar` y', 'code'), 'x foo b¦ar y')
    assert.equal(fmt('__hello wo¦rld__', 'bold'), 'hello wo¦rld')
  })

  it('removes the right mark when bold and italic are nested', () => {
    assert.equal(fmt('**bold *it¦al* more**', 'bold'), 'bold *it¦al* more')
    assert.equal(fmt('**bold *it¦al* more**', 'italic'), '**bold it¦al more**')
    assert.equal(fmt('***both wo¦rds***', 'bold'), '*both wo¦rds*')
  })

  it('adds italic to a word inside a bold phrase instead of unwrapping it', () => {
    assert.equal(fmt('**hello wo¦rld**', 'italic'), '**hello *wo¦rld***')
  })

  it('ignores markers inside inline code and neighbouring phrases', () => {
    assert.equal(fmt('**a** b¦b **c**', 'bold'), '**a** **b¦b** **c**')
    assert.equal(fmt('`**x**` w¦ord', 'bold'), '`**x**` **w¦ord**')
  })

  it('splits the phrase around a selection inside it', () => {
    assert.equal(fmt('say **hello ‹world›** now', 'bold'), 'say **hello** ‹world› now')
    assert.equal(fmt('say **‹hello› world** now', 'bold'), 'say ‹hello› **world** now')
    assert.equal(fmt('**one ‹two› three**', 'bold'), '**one** ‹two› **three**')
    assert.equal(fmt('`foo ‹bar›`', 'code'), '`foo` ‹bar›')
    assert.equal(fmt('~~a ‹b› c~~', 'strikethrough'), '~~a~~ ‹b› ~~c~~')
  })

  it('takes the mark off when the cursor sits right against the markers', () => {
    assert.equal(fmt('**hello**¦ world', 'bold'), 'hello¦ world')
    assert.equal(fmt('¦**hello**', 'bold'), '¦hello')
    assert.equal(fmt('*a*¦', 'italic'), 'a¦')
  })

  it('merges a selection with a phrase it overlaps instead of nesting markers', () => {
    assert.equal(fmt('**hel‹lo** wo›rld', 'bold'), '**hel‹lo wo›**rld')
    assert.equal(fmt('‹see **bold** text›', 'bold'), '**‹see bold text›**')
    assert.equal(fmt('a ‹b **c›** d', 'bold'), 'a **‹b c›** d')
    assert.equal(fmt('***hel‹lo*** wo›rld', 'bold'), '***hel‹lo* wo›**rld')
  })

  it('does not pair escaped markers', () => {
    assert.equal(fmt('\\*not ita¦lic*', 'italic'), '\\*not *ita¦lic**')
  })

  it('keeps italic on the rest of a *** phrase when bold comes off part of it', () => {
    assert.equal(fmt('***hello ‹world›***', 'bold'), '***hello** ‹world›*')
  })

  it('treats snake_case as one word', () => {
    assert.equal(fmt('use snake_c¦ase here', 'italic'), 'use *snake_c¦ase* here')
    assert.equal(fmt('use *snake_c¦ase* here', 'italic'), 'use snake_c¦ase here')
    assert.equal(fmt('my_v¦ar', 'bold'), '**my_v¦ar**')
  })
})

describe('block commands and fenced code', () => {
  it('leaves lines inside a fence alone for headings and lists', () => {
    assert.equal(applyFormat('heading1', parse('```\nco¦de\n```')), null)
    assert.equal(applyFormat('bulletList', parse('```\nfo¦o\n```')), null)
    assert.equal(applyFormat('numberedList', parse('~~~\n¦\n~~~')), null)
  })

  it('formats the prose around a fence but not the code in it', () => {
    assert.equal(fmt('‹para\n```\ncode\n```›', 'heading2'), '## ‹para\n```\ncode\n```›')
    assert.equal(fmt('‹one\n```\ntwo\n```›', 'bulletList'), '- ‹one\n```\ntwo\n```›')
  })

  it('quotes a fence only when the whole block is selected', () => {
    assert.equal(applyFormat('quote', parse('```\nco¦de\n```')), null)
    assert.equal(fmt('‹para\n```\ncode\n```›', 'quote'), '> ‹para\n> ```\n> code\n> ```›')
  })

  it('does not treat list-like lines in a fence as items for Tab', () => {
    assert.equal(indentList(parse('```\n- a\n- ¦b\n```'), 1), null)
  })

  it('carries a nested fence along with its item', () => {
    const state = parse('- a\n- ‹b\n  ```\n  - x\n  ```›')
    const edit = indentList(state, 1)
    assert.ok(edit)
    assert.equal(applyEdit(state.text, edit), '- a\n  - b\n    ```\n    - x\n    ```')
  })

  it('does not renumber numbered lines inside a fence', () => {
    assert.equal(
      fmt('¦a\n1. b\n   ```\n   7. code\n   7. more\n   ```\n2. c', 'numberedList'),
      '1. ¦a\n2. b\n   ```\n   7. code\n   7. more\n   ```\n3. c'
    )
  })
})

describe('pasted tables', () => {
  it('puts the cursor in a fresh paragraph below a pasted table', () => {
    const state = parse('text¦')
    assert.equal(show(state.text, insertBlockText(state, '| a |\n| - |', true)), 'text\n\n| a |\n| - |\n\n¦')
  })

  it('keeps a blank line between the fresh paragraph and the next block', () => {
    const state = parse('¦\nnext')
    assert.equal(show(state.text, insertBlockText(state, '| a |\n| - |', true)), '| a |\n| - |\n\n¦\n\nnext')
  })
})

describe('links around the cursor', () => {
  it('turns a link back into its text from anywhere inside it', () => {
    assert.equal(fmt('see [do¦cs](http://a) ok', 'link'), 'see ‹docs› ok')
    assert.equal(fmt('see [docs](http://¦a) ok', 'link'), 'see ‹docs› ok')
  })

  it('links a whole image instead of nesting inside it', () => {
    assert.equal(fmt('![al¦t](x.png)', 'link'), '[![alt](x.png)](‹url›)')
  })

  it('does not unlink when the cursor only touches the link', () => {
    assert.equal(fmt('[a](u) wo¦rd', 'link'), '[a](u) [word](‹url›)')
  })
})
