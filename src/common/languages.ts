import { cssLanguage } from '@codemirror/lang-css'
import { htmlLanguage } from '@codemirror/lang-html'
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { jsonLanguage } from '@codemirror/lang-json'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { pythonLanguage } from '@codemirror/lang-python'
import { StandardSQL } from '@codemirror/lang-sql'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import babelPlugin from 'prettier/plugins/babel'
import estreePlugin from 'prettier/plugins/estree'
import htmlPlugin from 'prettier/plugins/html'
import markdownPlugin from 'prettier/plugins/markdown'
import postcssPlugin from 'prettier/plugins/postcss'
import typescriptPlugin from 'prettier/plugins/typescript'
import yamlPlugin from 'prettier/plugins/yaml'

export type LanguageSpec = {
  token: string
  name: string
  parser: any
  prettier?: {
    parser: string
    plugins: unknown[]
  }
}

export const languages: LanguageSpec[] = [
  { token: 'text', name: 'Text', parser: null },
  { token: 'math', name: 'Math', parser: null },
  { token: 'markdown', name: 'Markdown', parser: markdownLanguage.parser, prettier: { parser: 'markdown', plugins: [markdownPlugin] } },
  { token: 'json', name: 'JSON', parser: jsonLanguage.parser, prettier: { parser: 'json-stringify', plugins: [babelPlugin, estreePlugin] } },
  { token: 'javascript', name: 'JavaScript', parser: javascriptLanguage.parser, prettier: { parser: 'babel', plugins: [babelPlugin, estreePlugin] } },
  { token: 'typescript', name: 'TypeScript', parser: typescriptLanguage.parser, prettier: { parser: 'typescript', plugins: [typescriptPlugin, estreePlugin] } },
  { token: 'python', name: 'Python', parser: pythonLanguage.parser },
  { token: 'sql', name: 'SQL', parser: StandardSQL.language.parser },
  { token: 'shell', name: 'Shell', parser: StreamLanguage.define(shell).parser },
  { token: 'yaml', name: 'YAML', parser: StreamLanguage.define(yaml).parser, prettier: { parser: 'yaml', plugins: [yamlPlugin] } },
  { token: 'html', name: 'HTML', parser: htmlLanguage.parser, prettier: { parser: 'html', plugins: [htmlPlugin] } },
  { token: 'css', name: 'CSS', parser: cssLanguage.parser, prettier: { parser: 'css', plugins: [postcssPlugin] } },
]

export const languageTokens = languages.map(language => language.token)

export function getLanguage(token: string): LanguageSpec {
  return languages.find(language => language.token === token) || languages[0]
}

export function detectLanguage(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return 'text'
  if (/^[-*#>`]/.test(trimmed) || /\n#{1,6}\s/.test(trimmed)) return 'markdown'
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return 'json'
  if (/^\s*(select|with|insert|update|delete)\s+/i.test(trimmed)) return 'sql'
  if (/^\s*(def|import|from|class)\s+\w+/m.test(trimmed)) return 'python'
  if (/^\s*(const|let|function|import|export)\s+/m.test(trimmed)) return 'javascript'
  if (/^\s*[\w.]+\s*=\s*[-+*/\d(]/m.test(trimmed) || /^\s*[-+*/().\d\s]+\s*$/m.test(trimmed)) return 'math'
  return 'text'
}
