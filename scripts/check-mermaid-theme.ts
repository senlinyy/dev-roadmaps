import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const IGNORED_DIRECTORIES = new Set(['.git', 'dist', 'node_modules']);
const MERMAID_FENCE = /^```mermaid\s*$/;
const CODE_FENCE_END = /^```\s*$/;
const PRESENTATION_STATEMENT = /(?:^|;)\s*(?:classDef|style)\b/;
const PRESENTATION_LINK_STYLE = /(?:^|;)\s*linkStyle\b[^;]*\b(?:fill|stroke|stroke-width|color)\s*:/i;
const EMBEDDED_THEME = /^\s*%%\{init:.*(?:"theme"\s*:|"themeVariables"\s*:)/i;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/i;

type Violation = {
  file: string;
  line: number;
  source: string;
};

function listMarkdownFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED_DIRECTORIES.has(entry.name)) return [];
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.md') ? [absolutePath] : [];
  });
}

function findViolations(file: string): Violation[] {
  const violations: Violation[] = [];
  let inMermaidBlock = false;

  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (!inMermaidBlock && MERMAID_FENCE.test(line)) {
      inMermaidBlock = true;
      return;
    }
    if (inMermaidBlock && CODE_FENCE_END.test(line)) {
      inMermaidBlock = false;
      return;
    }
    if (!inMermaidBlock) return;

    if (
      PRESENTATION_STATEMENT.test(line)
      || PRESENTATION_LINK_STYLE.test(line)
      || EMBEDDED_THEME.test(line)
      || COLOR_LITERAL.test(line)
    ) {
      violations.push({
        file: path.relative(ROOT_DIR, file),
        line: index + 1,
        source: line.trim(),
      });
    }
  });

  return violations;
}

const markdownFiles = listMarkdownFiles(ROOT_DIR);
const violations = markdownFiles.flatMap(findViolations);

if (violations.length > 0) {
  violations.forEach((violation) => {
    console.error(`${violation.file}:${violation.line}: ${violation.source}`);
  });
  throw new Error(`Found ${violations.length} Mermaid presentation rule violation(s)`);
}

console.log(`Validated Mermaid theme ownership across ${markdownFiles.length} Markdown files.`);
