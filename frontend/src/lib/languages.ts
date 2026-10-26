export interface LanguageMeta {
  id: string;
  label: string;
  /** short badge text */
  tag: string;
  extensions: string;
  /** noun used for the top-level declarations of this language */
  declares: string;
}

/** Must match `LANGUAGES` in backend/parser.py. */
export const LANGUAGES: LanguageMeta[] = [
  { id: 'python', label: 'Python', tag: 'PY', extensions: '.py', declares: 'Classes' },
  { id: 'javascript', label: 'JavaScript', tag: 'JS', extensions: '.js .jsx .mjs .cjs', declares: 'Classes' },
  { id: 'typescript', label: 'TypeScript', tag: 'TS', extensions: '.ts .tsx', declares: 'Classes & interfaces' },
  { id: 'java', label: 'Java', tag: 'JAVA', extensions: '.java', declares: 'Types' },
  { id: 'c', label: 'C', tag: 'C', extensions: '.c .h', declares: 'Structs' },
  { id: 'cpp', label: 'C++', tag: 'C++', extensions: '.cpp .cc .hpp .h', declares: 'Classes & structs' },
  { id: 'csharp', label: 'C#', tag: 'C#', extensions: '.cs', declares: 'Types' },
  { id: 'sql', label: 'SQL', tag: 'SQL', extensions: '.sql', declares: 'Tables & views' },
];

export const langMeta = (id: string | undefined): LanguageMeta | undefined => LANGUAGES.find((l) => l.id === id);
export const langTag = (id: string | undefined): string => langMeta(id)?.tag ?? (id ?? '').toUpperCase();
