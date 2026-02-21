/**
 * SyntaxHighlighter.tsx
 *
 * Lightweight regex-based syntax highlighting for common languages.
 * GitHub Dark theme colours – no external deps.
 */

import React, { useMemo } from 'react'
import { Text, View } from 'react-native'

/* ─── Token types & colours (GitHub dark) ─── */

const COLORS: Record<string, string> = {
  keyword: '#ff7b72',
  string: '#a5d6ff',
  comment: '#8b949e',
  number: '#79c0ff',
  function: '#d2a8ff',
  type: '#ffa657',
  operator: '#ff7b72',
  punctuation: '#c9d1d9',
  tag: '#7ee787',
  attribute: '#79c0ff',
  property: '#79c0ff',
  regex: '#a5d6ff',
  builtin: '#ffa657',
  default: '#e6edf3',
}

type Token = { text: string; type: string }

/* ─── Language token rules ─── */

const RULES: Record<string, [RegExp, string][]> = {}

// JS / TS / JSX / TSX
const jsRules: [RegExp, string][] = [
  [/\/\/.*$/gm, 'comment'],
  [/\/\*[\s\S]*?\*\//gm, 'comment'],
  [/(["'`])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [
    /\b(import|export|from|default|as|async|await|return|yield|throw|new|delete|typeof|instanceof|in|of|void|class|extends|implements|interface|type|enum|namespace|module|declare|abstract|static|readonly|override|public|private|protected|get|set|constructor)\b/g,
    'keyword',
  ],
  [
    /\b(if|else|for|while|do|switch|case|break|continue|try|catch|finally|with)\b/g,
    'keyword',
  ],
  [/\b(const|let|var|function|this|super)\b/g, 'keyword'],
  [/\b(true|false|null|undefined|NaN|Infinity)\b/g, 'builtin'],
  [
    /\b(console|window|document|global|globalThis|process|require|module|exports)\b/g,
    'builtin',
  ],
  [
    /\b(Array|Object|String|Number|Boolean|Map|Set|Promise|RegExp|Error|Date|Math|JSON|Symbol|Buffer)\b/g,
    'type',
  ],
  [/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'number'],
  [/\b0x[0-9a-fA-F]+\b/g, 'number'],
  [/\b([A-Z][a-zA-Z0-9_]*)\b/g, 'type'],
  [/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, 'function'],
  [/[{}()\[\];,.:?]/g, 'punctuation'],
  [/[+\-*/%=!<>&|^~]+/g, 'operator'],
]
RULES['js'] = jsRules
RULES['jsx'] = jsRules
RULES['ts'] = jsRules
RULES['tsx'] = jsRules
RULES['mjs'] = jsRules
RULES['cjs'] = jsRules

// JSON
RULES['json'] = [
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1(?=\s*:)/g, 'property'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [/\b(true|false|null)\b/g, 'keyword'],
  [/\b-?\d+\.?\d*([eE][+-]?\d+)?\b/g, 'number'],
  [/[{}()\[\],.:]/g, 'punctuation'],
]

// Python
RULES['py'] = [
  [/#.*$/gm, 'comment'],
  [/("""[\s\S]*?"""|'''[\s\S]*?''')/gm, 'string'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [
    /\b(import|from|as|def|class|return|yield|lambda|if|elif|else|for|while|break|continue|try|except|finally|raise|with|pass|del|assert|global|nonlocal|async|await|and|or|not|is|in)\b/g,
    'keyword',
  ],
  [/\b(True|False|None)\b/g, 'builtin'],
  [
    /\b(print|len|range|int|str|float|list|dict|set|tuple|type|isinstance|super|self|cls)\b/g,
    'builtin',
  ],
  [/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'number'],
  [/\b([A-Z][a-zA-Z0-9_]*)\b/g, 'type'],
  [/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, 'function'],
  [/@\w+/g, 'function'],
  [/[{}()\[\];,.:?]/g, 'punctuation'],
  [/[+\-*/%=!<>&|^~]+/g, 'operator'],
]

// HTML / XML
RULES['html'] = [
  [/<!--[\s\S]*?-->/gm, 'comment'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s|>|\/)/g, 'tag'],
  [/\b[a-zA-Z-]+(?==)/g, 'attribute'],
  [/[<>\/=]/g, 'punctuation'],
]
RULES['xml'] = RULES['html']
RULES['svg'] = RULES['html']

// CSS
RULES['css'] = [
  [/\/\*[\s\S]*?\*\//gm, 'comment'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [/#[0-9a-fA-F]{3,8}\b/g, 'number'],
  [/\b\d+\.?\d*(px|em|rem|%|vh|vw|deg|s|ms)?\b/g, 'number'],
  [/([.#]?[a-zA-Z_-][a-zA-Z0-9_-]*)(?=\s*\{)/g, 'tag'],
  [
    /\b(color|background|border|margin|padding|font|display|position|width|height|flex|grid|align|justify|overflow|opacity|transform|transition|animation|z-index|cursor|gap)\b[a-zA-Z-]*/g,
    'property',
  ],
  [/[{}();:,]/g, 'punctuation'],
  [/!important/g, 'keyword'],
]
RULES['scss'] = RULES['css']

// Markdown
RULES['md'] = [
  [/^#{1,6}\s+.+$/gm, 'keyword'],
  [/\*\*[^*]+\*\*/g, 'keyword'],
  [/\*[^*]+\*/g, 'string'],
  [/`[^`]+`/g, 'function'],
  [/\[([^\]]+)\]\([^)]+\)/g, 'string'],
  [/^[ \t]*[-*+][ ]/gm, 'operator'],
  [/^>\s.*$/gm, 'comment'],
]
RULES['markdown'] = RULES['md']

// YAML
RULES['yml'] = [
  [/#.*$/gm, 'comment'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [/\b(true|false|null|yes|no)\b/gi, 'keyword'],
  [/^[\w.-]+(?=\s*:)/gm, 'property'],
  [/\b\d+\.?\d*\b/g, 'number'],
  [/[:|[\]{},>-]/g, 'punctuation'],
]
RULES['yaml'] = RULES['yml']

// Shell
RULES['sh'] = [
  [/#.*$/gm, 'comment'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [
    /\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|local|export|source|echo|cd|ls|mkdir|rm|cp|mv|cat|grep|sed|awk|find|chmod|chown|sudo|apt|npm|yarn|git|docker)\b/g,
    'keyword',
  ],
  [/\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/g, 'builtin'],
  [/\b\d+\b/g, 'number'],
  [/[|;&<>()]/g, 'operator'],
]
RULES['bash'] = RULES['sh']
RULES['zsh'] = RULES['sh']

// Java / Kotlin
const javaRules: [RegExp, string][] = [
  [/\/\/.*$/gm, 'comment'],
  [/\/\*[\s\S]*?\*\//gm, 'comment'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [
    /\b(abstract|assert|break|case|catch|class|continue|default|do|else|enum|extends|final|finally|for|if|implements|import|instanceof|interface|native|new|package|private|protected|public|return|static|super|switch|synchronized|this|throw|throws|transient|try|volatile|while|void|val|var|fun|object|companion|data|sealed|when|override|open|internal|lateinit|by|lazy|suspend|coroutine|inline|reified)\b/g,
    'keyword',
  ],
  [/\b(true|false|null)\b/g, 'builtin'],
  [
    /\b(int|long|short|byte|float|double|char|boolean|String|Int|Long|Short|Byte|Float|Double|Char|Boolean)\b/g,
    'type',
  ],
  [/\b\d+\.?\d*[fFdDlL]?\b/g, 'number'],
  [/\b0x[0-9a-fA-F]+\b/g, 'number'],
  [/\b([A-Z][a-zA-Z0-9_]*)\b/g, 'type'],
  [/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, 'function'],
  [/@\w+/g, 'function'],
  [/[{}()\[\];,.:?]/g, 'punctuation'],
  [/[+\-*/%=!<>&|^~]+/g, 'operator'],
]
RULES['kt'] = javaRules
RULES['gradle'] = javaRules

// Dockerfile / conf
RULES['dockerfile'] = [
  [/#.*$/gm, 'comment'],
  [/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, 'string'],
  [
    /^(FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|ENV|EXPOSE|VOLUME|WORKDIR|USER|ARG|LABEL|MAINTAINER|ONBUILD|SHELL|HEALTHCHECK|STOPSIGNAL)\b/gm,
    'keyword',
  ],
  [/\b\d+\b/g, 'number'],
]

// Fallback / plain text
RULES['txt'] = []
RULES[''] = []

/* ─── Tokeniser ─── */

function tokenize(code: string, ext: string): Token[][] {
  const rules = RULES[ext] ?? RULES['']
  const lines = code.split('\n')

  return lines.map((line) => {
    if (rules.length === 0) return [{ text: line || ' ', type: 'default' }]

    // Build a map of character-level colours
    const charTypes = new Array(line.length).fill('default')

    for (const [regex, type] of rules) {
      regex.lastIndex = 0
      const re = new RegExp(regex.source, regex.flags)
      let match: RegExpExecArray | null
      while ((match = re.exec(line)) !== null) {
        const start = match.index
        const end = start + match[0].length
        for (let i = start; i < end && i < line.length; i++) {
          if (charTypes[i] === 'default') charTypes[i] = type
        }
        if (match[0].length === 0) re.lastIndex++
      }
    }

    // Merge adjacent characters with same type into tokens
    const tokens: Token[] = []
    let i = 0
    while (i < line.length) {
      const type = charTypes[i]
      let j = i
      while (j < line.length && charTypes[j] === type) j++
      tokens.push({ text: line.slice(i, j), type })
      i = j
    }

    if (tokens.length === 0) tokens.push({ text: ' ', type: 'default' })
    return tokens
  })
}

/* ─── Extension resolver ─── */

function getExt(filename: string): string {
  if (!filename) return ''
  const base = filename.split('/').pop() ?? ''
  // Handle dotfiles
  if (base === 'Dockerfile') return 'dockerfile'
  if (base === 'Makefile') return 'sh'
  if (base === '.gitignore' || base === '.env') return 'sh'
  const idx = base.lastIndexOf('.')
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : ''
}

/* ─── Component ─── */

type Props = {
  code: string
  filename: string
  showLineNumbers?: boolean
  fontSize?: number
  startLine?: number
}

export default function SyntaxHighlighter({
  code,
  filename,
  showLineNumbers = true,
  fontSize = 11,
  startLine = 1,
}: Props) {
  const ext = getExt(filename)
  const tokenLines = useMemo(() => tokenize(code, ext), [code, ext])

  return (
    <View>
      {tokenLines.map((tokens, idx) => (
        <View key={idx} style={{ flexDirection: 'row' }}>
          {showLineNumbers && (
            <Text
              style={{
                color: '#484f58',
                fontSize,
                fontFamily: 'monospace',
                width: 36,
                textAlign: 'right',
                marginRight: 12,
                userSelect: 'none',
              }}
            >
              {startLine + idx}
            </Text>
          )}
          <Text style={{ flexDirection: 'row', flexShrink: 1 }}>
            {tokens.map((tok, ti) => (
              <Text
                key={ti}
                style={{
                  color: COLORS[tok.type] ?? COLORS.default,
                  fontSize,
                  fontFamily: 'monospace',
                }}
              >
                {tok.text}
              </Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  )
}

export { COLORS, getExt, tokenize }
