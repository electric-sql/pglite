import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import CodeMirror, {
  type ViewUpdate,
  type ReactCodeMirrorRef,
  type Extension,
} from '@uiw/react-codemirror'
import type { CreateThemeOptions } from '@uiw/codemirror-themes'
import { defaultKeymap } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { PostgreSQL } from '@codemirror/lang-sql'
import type { PGliteInterface } from '@electric-sql/pglite'
import type { PGliteWithLive } from '@electric-sql/pglite/live'
import { usePGlite } from '@electric-sql/pglite-react'
import { makeSqlExt } from './sqlSupport'
import type { Response } from './types'
import { runQuery, getSchema } from './utils'
import { ReplResponse } from './ReplResponse'
import {
  githubDark,
  githubDarkInit,
  githubLight,
  githubLightInit,
} from '@uiw/codemirror-theme-github'

import './Repl.css'

// Filter out the Enter key from the default keymap, we entirely override its behavior
// to run the query when the user presses Enter.
// We keep the up and down arrow keys as we only override their behavior
// when the cursor is on the first or last line.
const baseKeymap = defaultKeymap.filter((key) => key.key !== 'Enter')

export type ReplTheme = 'light' | 'dark' | 'auto'

type ThemeInit = (options?: Partial<CreateThemeOptions>) => Extension

export const defaultLightThemeInit: ThemeInit = githubLightInit
export const defaultLightTheme = githubLight
export const defaultDarkThemeInit: ThemeInit = githubDarkInit
export const defaultDarkTheme = githubDark

export interface ReplProps {
  pg?: PGliteInterface
  border?: boolean
  lightTheme?: Extension
  darkTheme?: Extension
  theme?: ReplTheme
  showTime?: boolean
  disableUpdateSchema?: boolean
}

export function Repl({
  pg: pgProp,
  border = false,
  lightTheme = defaultLightTheme,
  darkTheme = defaultDarkTheme,
  theme = 'auto',
  showTime = false,
  disableUpdateSchema = false,
}: ReplProps) {
  const [value, setValue] = useState('')
  const valueNoHistory = useRef('')
  const [loading, setLoading] = useState(true)
  const [output, setOutput] = useState<Response[]>([])
  const outputRef = useRef<HTMLDivElement | null>(null)
  const [schema, setSchema] = useState<Record<string, string[]>>({})
  const historyPos = useRef(-1)
  const rcm = useRef<ReactCodeMirrorRef | null>(null)
  const [themeToUse, setThemeToUse] = useState<Extension>(
    theme === 'dark' ? darkTheme : lightTheme,
  )
  const [styles, setStyles] = useState<{ [key: string]: string | number }>({})

  const pg: PGliteInterface = usePGlite(pgProp as PGliteWithLive)

  useEffect(() => {
    let ignore = false
    const init = async () => {
      await pg.waitReady
      if (ignore) return
      setLoading(false)
    }
    setLoading(true)
    init()
    return () => {
      ignore = true
    }
  }, [pg])

  useEffect(() => {
    if (theme === 'auto') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light'
      setThemeToUse(systemTheme === 'dark' ? darkTheme : lightTheme)
      const listener = (e: MediaQueryListEvent) => {
        setThemeToUse(e.matches ? darkTheme : lightTheme)
        setTimeout(() => {
          extractStyles()
        }, 0)
      }
      // eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', listener)
      return () => {
        window
          .matchMedia('(prefers-color-scheme: dark)')
          .removeEventListener('change', listener)
      }
    } else {
      setThemeToUse(theme === 'dark' ? darkTheme : lightTheme)
      setTimeout(() => {
        extractStyles()
      }, 0)
      return
    }
  }, [theme, lightTheme, darkTheme])

  const onChange = useCallback((val: string, _viewUpdate: ViewUpdate) => {
    extractStyles()
    setValue(val)
    if (historyPos.current === -1) {
      valueNoHistory.current = val
    }
  }, [])

  const extensions = useMemo(
    () => [
      keymap.of([
        {
          key: 'Enter',
          preventDefault: true,
          run: () => {
            if (value.trim() === '') return false // Do nothing if the input is empty
            runQuery(value, pg).then((response) => {
              setOutput((prev) => [...prev, response])
              if (outputRef.current) {
                setTimeout(() => {
                  outputRef.current!.scrollTop = outputRef.current!.scrollHeight
                }, 0)
              }
              // Update the schema for any new tables to be used in autocompletion
              if (!disableUpdateSchema) {
                getSchema(pg).then(setSchema)
              }
            })
            historyPos.current = -1
            valueNoHistory.current = ''
            setValue('')
            return true
          },
        },
        {
          key: 'ArrowUp',
          run: (view) => {
            const state = view.state
            const cursorLine = state.doc.lineAt(
              state.selection.main.head,
            ).number
            if (cursorLine === 1) {
              // If the cursor is on the first line, go back in history
              const currentPos = historyPos.current
              historyPos.current++
              if (historyPos.current >= output.length) {
                historyPos.current = output.length - 1
              }
              if (historyPos.current < -1) {
                historyPos.current = -1
              }
              if (historyPos.current === currentPos) return true
              if (historyPos.current === -1) {
                setValue(valueNoHistory.current)
              } else {
                setValue(output[output.length - historyPos.current - 1].query)
              }
              return true // Prevent the default behavior
            }
            return false // Allow the default behavior
          },
        },
        {
          key: 'ArrowDown',
          run: (view) => {
            const state = view.state
            const cursorLine = state.doc.lineAt(
              state.selection.main.head,
            ).number
            const lastLine = state.doc.lines
            if (cursorLine === lastLine) {
              // If the cursor is on the last line, go forward in history
              const currentPos = historyPos.current
              historyPos.current--
              if (historyPos.current >= output.length) {
                historyPos.current = output.length - 1
              }
              if (historyPos.current < -1) {
                historyPos.current = -1
              }
              if (historyPos.current === currentPos) return true
              if (historyPos.current === -1) {
                setValue(valueNoHistory.current)
              } else {
                setValue(output[output.length - historyPos.current - 1].query)
              }
              return true // Prevent the default behavior
            }
            return false // Allow the default behavior
          },
        },
        ...baseKeymap,
      ]),
      makeSqlExt({
        dialect: PostgreSQL,
        schema: schema,
        tables: [
          {
            label: 'd',
            displayLabel: '\\d',
          },
        ],
        defaultSchema: 'public',
      }),
    ],
    [pg, schema, value, output, disableUpdateSchema],
  )

  const extractStyles = () => {
    // Get the styles from the CodeMirror editor to use in the REPL
    const cmEditorEl = rcm.current?.editor?.querySelector('.cm-editor')
    if (!cmEditorEl) {
      throw new Error('No CodeMirror editor found')
    }
    const gutterEl = cmEditorEl.querySelector('.cm-gutters')
    const cmEditorElComputedStyles = window.getComputedStyle(cmEditorEl)
    const foregroundColor = cmEditorElComputedStyles.color
    const backgroundColor = cmEditorElComputedStyles.backgroundColor

    const gutterElComputedStyles = window.getComputedStyle(gutterEl!)
    const gutterBorder = gutterElComputedStyles.borderRight
    const borderWidth = parseInt(gutterElComputedStyles.borderRightWidth) || 0
    const borderColor = borderWidth
      ? gutterElComputedStyles.borderRightColor
      : foregroundColor.replace('rgb', 'rgba').replace(')', ', 0.15)')
    const border = borderWidth
      ? gutterElComputedStyles.borderRight
      : `1px solid ${borderColor}`

    setStyles({
      '--PGliteRepl-foreground-color': foregroundColor,
      '--PGliteRepl-background-color': backgroundColor,
      '--PGliteRepl-border': border,
      '--PGliteRepl-gutter-border': gutterBorder,
      '--PGliteRepl-border-color': borderColor,
    })
  }

  return (
    <div
      className={`
      PGliteRepl-root
      ${border ? 'PGliteRepl-root-border' : ''}
    `}
      style={styles}
    >
      <div className="PGliteRepl-output" ref={outputRef}>
        {loading && <div className="PGliteRepl-loading-msg">Loading...</div>}
        {output.map((response) => (
          <div key={`${response.query}-${response.time}`}>
            <ReplResponse response={response || []} showTime={showTime} />
          </div>
        ))}
      </div>
      <CodeMirror
        ref={rcm}
        className={`PGliteRepl-input ${loading ? 'PGliteRepl-input-loading' : ''}`}
        width="100%"
        value={value}
        basicSetup={{
          defaultKeymap: false,
        }}
        extensions={extensions}
        theme={themeToUse}
        onChange={onChange}
        editable={!loading}
        onCreateEditor={() => {
          extractStyles()
          setTimeout(extractStyles, 0)
          getSchema(pg).then(setSchema)
        }}
      />
    </div>
  )
}
