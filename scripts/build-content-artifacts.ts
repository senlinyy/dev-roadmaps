import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT_DIR = process.cwd();
const DIST_ROOT = path.join(ROOT_DIR, 'dist');
const GENERATED_AT = new Date().toISOString();
const VERSION =
  process.env.DEVPOLARIS_CONTENT_VERSION?.trim() ||
  `local-${GENERATED_AT.replace(/[-:.TZ]/g, '').slice(0, 14)}`;

const COLORS = {
  coral: '#FF8A80',
  butterYellow: '#FFE082',
  aqua: '#5CE0D2',
  mint: '#A8E6CF',
  lavender: '#B39DDB',
  successGreen: '#A7F3D0',
  errorRed: '#FCA5A5',
  white: '#ffffff',
} as const;

const ROADMAP_ACCENT_ORDER = [
  COLORS.coral,
  COLORS.butterYellow,
  COLORS.aqua,
  COLORS.mint,
  COLORS.lavender,
];

const ARTICLE_EXPANDABLE_KINDS = new Set(['design', 'pattern', 'pitfall', 'history', 'example']);
const ARTICLE_EXPANDABLE_START_RE = /^:::expand(?:\[([^\]]+)\])?(?:\{([^}]*)\})?\s*$/;
const ARTICLE_EXPANDABLE_END_RE = /^:::\s*$/;

const DEFAULT_ROADMAP_SLUG = 'devops';

const DEFAULT_ROADMAP_BASE: Omit<RoadmapSummary, 'rootCount' | 'articleCount'> = {
  id: 'roadmap-devops',
  slug: DEFAULT_ROADMAP_SLUG,
  title: 'DevOps Roadmap',
  description: 'Build practical fluency across Linux, networking, cloud, CI/CD, infrastructure as code, containers, Kubernetes, and DevSecOps.',
  category: 'career',
  tags: ['Linux', 'Cloud', 'CI/CD', 'Kubernetes'],
  icon: 'Map',
  order: 1,
  available: true,
};

const PLANNED_ROADMAP_BASES: Array<Omit<RoadmapSummary, 'rootCount' | 'articleCount'>> = [
  {
    id: 'roadmap-data-engineering',
    slug: 'data-engineering',
    title: 'Data Engineering Roadmap',
    description: 'Learn the systems path from SQL and data modeling through warehouses, orchestration, streaming, reliability, and analytics platforms.',
    category: 'career',
    tags: ['SQL', 'Pipelines', 'Warehouses', 'Streaming'],
    icon: 'Database',
    order: 2,
    available: false,
  },
  {
    id: 'roadmap-rust',
    slug: 'rust',
    title: 'Rust Roadmap',
    description: 'Build language fluency from ownership and borrowing through traits, generics, async Rust, crates, tooling, and production patterns.',
    category: 'language',
    tags: ['Ownership', 'Traits', 'Async', 'Cargo'],
    icon: 'Code2',
    order: 3,
    available: false,
  },
];

type ContentTags = string[];

type MetaRecord = Record<string, unknown>;

type ChildModule = {
  id: string;
  title: string;
  category: 'Child Module';
  color: string;
  description: string;
  contentPath: string;
  aliases?: string[];
  tags: ContentTags;
};

type ArticleCatalogItem = {
  id: string;
  title: string;
  slug: string;
  contentPath: string | null;
  aliases: string[];
};

type SubModule = {
  id: string;
  title: string;
  category: 'Sub-module';
  color: string;
  description: string;
  tags: ContentTags;
  children: ChildModule[];
};

type GroupModule = {
  id: string;
  title: string;
  category: 'Group';
  color: string;
  description: string;
  tags: ContentTags;
  subs: SubModule[];
};

type RootChild = ChildModule | SubModule | GroupModule;

type RootModule = {
  id: string;
  title: string;
  category: 'Root Module';
  color: string;
  icon: string;
  description: string;
  tags: ContentTags;
  subs: RootChild[];
};

type RoadmapCategory = 'career' | 'language' | 'platform' | 'framework' | 'other';

type RoadmapSummary = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: RoadmapCategory;
  tags: ContentTags;
  icon: string;
  order: number;
  available: boolean;
  rootCount: number;
  articleCount: number;
};

type Roadmap = RoadmapSummary & {
  roots: RootModule[];
};

type Ordered<T> = {
  order: number;
  module: T;
};

type ChallengeCategoryMeta = {
  id: string;
  title: string;
  description: string;
  kind: string;
  icon: string;
  color: string;
  order: number;
  available: boolean;
};

type ChallengeGroupMeta = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  order: number;
  articleId?: string;
  articleSlug?: string;
  practiceOnly: boolean;
  tags: ContentTags;
  category: string;
  stepCount: number;
};

type ChallengeConfig = Record<string, unknown>;

type QuizConfig = Record<string, unknown>;

type EditorConfig = Record<string, unknown>;

type ChallengeStepBase = {
  id: string;
  title: string;
  sectionSlug?: string;
  order: number;
  description: string;
  solution: string;
  hints: string[];
};

type PracticalChallengeStep = ChallengeStepBase & {
  kind: 'practical';
  config: ChallengeConfig;
};

type QuizChallengeStep = ChallengeStepBase & {
  kind: 'quiz';
  quiz: QuizConfig;
};

type EditorChallengeStep = ChallengeStepBase & {
  kind: 'editor';
  editor: EditorConfig;
};

type ChallengeStep = PracticalChallengeStep | QuizChallengeStep | EditorChallengeStep;

type ChallengeGroupFull = ChallengeGroupMeta & {
  steps: ChallengeStep[];
};

type SectionPracticeLink = {
  category: string;
  groupId: string;
  stepId: string;
  stepIndex: number;
  stepTitle: string;
  groupTitle: string;
  kind: ChallengeStep['kind'];
};

type Manifest = {
  version: string;
  generatedAt: string;
  articleCatalog: ArticleCatalogItem[];
  roadmapSummaries: RoadmapSummary[];
  roadmaps: Roadmap[];
  roadmapData: RootModule[];
  categories: ChallengeCategoryMeta[];
  groupsByCategory: Record<string, ChallengeGroupMeta[]>;
  groupsByArticle: Record<string, ChallengeGroupMeta[]>;
  groupsByArticleId: Record<string, ChallengeGroupMeta[]>;
  sectionPracticeByArticle: Record<string, Record<string, SectionPracticeLink[]>>;
  sectionPracticeByArticleId: Record<string, Record<string, SectionPracticeLink[]>>;
};

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function getFallbackArticleId(contentPath: string): string {
  return `article-${contentPath
    .replace(/\.md$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}`;
}

function getLegacyGeneratedArticleId(contentPath: string): string | null {
  const segments = contentPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const fileName = segments[segments.length - 1];
  const subDir = segments[segments.length - 2];
  const fileSlug = fileName.replace(/\.md$/, '');
  return `child-${subDir}-${fileSlug}`;
}

function getRoadmapAccentColor(index: number): string {
  return ROADMAP_ACCENT_ORDER[index % ROADMAP_ACCENT_ORDER.length];
}

function isRoadmapCategory(value: unknown): value is RoadmapCategory {
  return value === 'career'
    || value === 'language'
    || value === 'platform'
    || value === 'framework'
    || value === 'other';
}

function isRootArticle(child: RootChild): child is ChildModule {
  return child.category === 'Child Module';
}

function countRoadmapArticles(roots: RootModule[]): number {
  let count = 0;

  for (const root of roots) {
    for (const child of root.subs) {
      if (isRootArticle(child)) {
        count += 1;
        continue;
      }

      const subs = child.category === 'Group' ? child.subs : [child];
      for (const sub of subs) {
        count += sub.children.length;
      }
    }
  }

  return count;
}

function createRoadmapSummary(
  base: Omit<RoadmapSummary, 'rootCount' | 'articleCount'>,
  roots: RootModule[],
): RoadmapSummary {
  return {
    ...base,
    rootCount: roots.length,
    articleCount: countRoadmapArticles(roots),
  };
}

function createRoadmap(base: Omit<RoadmapSummary, 'rootCount' | 'articleCount'>, roots: RootModule[]): Roadmap {
  return {
    ...createRoadmapSummary(base, roots),
    roots,
  };
}

function createDefaultRoadmap(roots: RootModule[]): Roadmap {
  return createRoadmap(DEFAULT_ROADMAP_BASE, roots);
}

function summarizeRoadmap(roadmap: Roadmap): RoadmapSummary {
  return {
    id: roadmap.id,
    slug: roadmap.slug,
    title: roadmap.title,
    description: roadmap.description,
    category: roadmap.category,
    tags: roadmap.tags,
    icon: roadmap.icon,
    order: roadmap.order,
    available: roadmap.available,
    rootCount: roadmap.rootCount,
    articleCount: roadmap.articleCount,
  };
}

function createPlannedRoadmaps(): Roadmap[] {
  return PLANNED_ROADMAP_BASES.map((base) => createRoadmap(base, []));
}

function mergeRoadmapsBySlug(roadmaps: Roadmap[]): Roadmap[] {
  const bySlug = new Map<string, Roadmap>();

  for (const roadmap of roadmaps) {
    bySlug.set(roadmap.slug, roadmap);
  }

  return Array.from(bySlug.values()).sort((left, right) => left.order - right.order);
}

function appendMissingPlannedRoadmaps(roadmaps: Roadmap[]): Roadmap[] {
  const mergedRoadmaps = mergeRoadmapsBySlug(roadmaps);
  const existingSlugs = new Set(mergedRoadmaps.map((roadmap) => roadmap.slug));
  const missingPlannedRoadmaps = createPlannedRoadmaps().filter((roadmap) => !existingSlugs.has(roadmap.slug));

  return mergeRoadmapsBySlug([...mergedRoadmaps, ...missingPlannedRoadmaps]);
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readMarkdown(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function readMatter(filePath: string): { data: MetaRecord; content: string } {
  const parsed = matter(readMarkdown(filePath));
  return {
    data: parsed.data as MetaRecord,
    content: parsed.content,
  };
}

function readMeta(filePath: string): MetaRecord {
  return readMatter(filePath).data;
}

function parseExpandableAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(raw)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  return attrs;
}

function validateArticleExpandables(content: string, filePath: string): void {
  const lines = content.split(/\r?\n/);
  let count = 0;
  let inBlock = false;
  let inFence = false;
  let blockStartLine = 0;
  let blockHasContent = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const lineNo = index + 1;
    const fence = /^\s*(```|~~~)/.test(line);

    if (fence) {
      inFence = !inFence;
      if (inBlock) blockHasContent = true;
      continue;
    }

    if (inFence) {
      if (inBlock && trimmed) {
        blockHasContent = true;
      }
      continue;
    }

    if (!inBlock && !inFence) {
      const start = ARTICLE_EXPANDABLE_START_RE.exec(trimmed);
      if (!start) continue;

      count += 1;
      blockStartLine = lineNo;
      blockHasContent = false;

      const title = start[1]?.trim();
      if (!title) {
        throw new Error(`${filePath}:${lineNo} expandable block is missing a title.`);
      }

      const attrs = parseExpandableAttributes(start[2] ?? '');
      if (!attrs.kind || !ARTICLE_EXPANDABLE_KINDS.has(attrs.kind)) {
        throw new Error(`${filePath}:${lineNo} expandable block must use kind="${Array.from(ARTICLE_EXPANDABLE_KINDS).join('|')}".`);
      }

      inBlock = true;
      continue;
    }

    if (!inBlock) continue;

    if (ARTICLE_EXPANDABLE_START_RE.test(trimmed)) {
      throw new Error(`${filePath}:${lineNo} nested expandable blocks are not supported.`);
    }

    if (ARTICLE_EXPANDABLE_END_RE.test(trimmed)) {
      if (!blockHasContent) {
        throw new Error(`${filePath}:${blockStartLine} expandable block must contain content.`);
      }
      inBlock = false;
      continue;
    }

    if (/^#{2,3}\s+/.test(trimmed)) {
      throw new Error(`${filePath}:${lineNo} expandable blocks cannot contain ## or ### headings.`);
    }

    if (trimmed) {
      blockHasContent = true;
    }
  }

  if (inBlock) {
    throw new Error(`${filePath}:${blockStartLine} expandable block is missing a closing ::: line.`);
  }

  if (count > 3) {
    throw new Error(`${filePath} has ${count} expandable blocks. Keep article expandables to 0-3 high-signal blocks.`);
  }
}

function dirs(parent: string): string[] {
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function hasArticles(dir: string): boolean {
  return fs.readdirSync(dir).some((name) => name.endsWith('.md') && name !== '_index.md');
}

function hasNestedSubs(dir: string): boolean {
  return dirs(dir).some((name) => exists(path.join(dir, name, '_index.md')));
}

function loadChildArticle(filePath: string, slug: string, contentPath: string): Ordered<ChildModule> {
  const childMatter = readMatter(filePath);
  validateArticleExpandables(childMatter.content, filePath);
  const childMeta = childMatter.data;
  const frontmatterId = asOptionalString(childMeta.id)?.trim();

  return {
    order: asNumber(childMeta.order, 99),
    module: {
      id: frontmatterId || getFallbackArticleId(contentPath),
      title: asString(childMeta.title, slug),
      category: 'Child Module',
      color: COLORS.white,
      description: asString(childMeta.description, ''),
      contentPath,
      aliases: asStringArray(childMeta.aliases),
      tags: asStringArray(childMeta.tags),
    },
  };
}

function loadSubModule(rootDir: string, parentPath: string[], subDir: string): Ordered<SubModule> | null {
  const subPath = path.join(ROOT_DIR, rootDir, ...parentPath, subDir);
  const subIndex = path.join(subPath, '_index.md');

  if (!exists(subIndex)) {
    return null;
  }

  const subMeta = readMeta(subIndex);
  const children: Ordered<ChildModule>[] = [];

  for (const fileName of fs.readdirSync(subPath).filter((name) => name.endsWith('.md') && name !== '_index.md')) {
    const slug = fileName.replace(/\.md$/, '');
    const contentPath = [rootDir, ...parentPath, subDir, fileName].join('/');
    children.push(loadChildArticle(path.join(subPath, fileName), slug, contentPath));
  }

  children.sort((left, right) => left.order - right.order);

  return {
    order: asNumber(subMeta.order, 99),
    module: {
      id: `sub-${[rootDir, ...parentPath, subDir].join('-')}`,
      title: asString(subMeta.title, subDir),
      category: 'Sub-module',
      color: COLORS.white,
      description: asString(subMeta.description, ''),
      tags: asStringArray(subMeta.tags),
      children: children.map((entry) => entry.module),
    },
  };
}

function loadGroupModule(rootDir: string, groupDir: string): Ordered<GroupModule> | null {
  const groupPath = path.join(ROOT_DIR, rootDir, groupDir);
  const groupIndex = path.join(groupPath, '_index.md');

  if (!exists(groupIndex)) {
    return null;
  }

  const groupMeta = readMeta(groupIndex);
  const subs: Ordered<SubModule>[] = [];

  for (const subDir of dirs(groupPath)) {
    const loaded = loadSubModule(rootDir, [groupDir], subDir);
    if (loaded) {
      subs.push(loaded);
    }
  }

  subs.sort((left, right) => left.order - right.order);

  return {
    order: asNumber(groupMeta.order, 99),
    module: {
      id: `group-${rootDir}-${groupDir}`,
      title: asString(groupMeta.title, groupDir),
      category: 'Group',
      color: COLORS.white,
      description: asString(groupMeta.description, ''),
      tags: asStringArray(groupMeta.tags),
      subs: subs.map((entry) => entry.module),
    },
  };
}

function loadRoadmapData(): RootModule[] {
  const roots: Ordered<RootModule>[] = [];

  for (const rootDir of dirs(ROOT_DIR)) {
    const rootPath = path.join(ROOT_DIR, rootDir);
    const indexFile = path.join(rootPath, '_index.md');

    if (!exists(indexFile)) {
      continue;
    }

    const rootMeta = readMeta(indexFile);
    const rootChildren: Ordered<RootChild>[] = [];

    for (const fileName of fs.readdirSync(rootPath).filter((name) => name.endsWith('.md') && name !== '_index.md')) {
      const slug = fileName.replace(/\.md$/, '');
      const contentPath = [rootDir, fileName].join('/');
      rootChildren.push(loadChildArticle(path.join(rootPath, fileName), slug, contentPath));
    }

    for (const childDir of dirs(rootPath)) {
      const childPath = path.join(rootPath, childDir);
      const childIndex = path.join(childPath, '_index.md');

      if (!exists(childIndex)) {
        continue;
      }

      if (hasArticles(childPath)) {
        const sub = loadSubModule(rootDir, [], childDir);
        if (sub) {
          rootChildren.push(sub);
        }
      } else if (hasNestedSubs(childPath)) {
        const group = loadGroupModule(rootDir, childDir);
        if (group) {
          rootChildren.push(group);
        }
      }
    }

    rootChildren.sort((left, right) => left.order - right.order);

    roots.push({
      order: asNumber(rootMeta.order, 99),
      module: {
        id: `root-${rootDir}`,
        title: asString(rootMeta.title, rootDir),
        category: 'Root Module',
        color: COLORS.coral,
        icon: asString(rootMeta.icon, 'BookOpen'),
        description: asString(rootMeta.description, ''),
        tags: asStringArray(rootMeta.tags),
        subs: rootChildren.map((entry) => entry.module),
      },
    });
  }

  roots.sort((left, right) => left.order - right.order);
  roots.forEach((entry, index) => {
    entry.module.color = getRoadmapAccentColor(index);
  });

  return roots.map((entry) => entry.module);
}

function scopedId(prefix: string, parts: string[]): string {
  return [prefix, ...parts].filter(Boolean).join('-');
}

function loadSubModuleFromBase(
  baseDir: string,
  contentPathPrefix: string[],
  nodeIdPrefix: string,
  rootDir: string,
  parentPath: string[],
  subDir: string,
): Ordered<SubModule> | null {
  const subPath = path.join(baseDir, rootDir, ...parentPath, subDir);
  const subIndex = path.join(subPath, '_index.md');

  if (!exists(subIndex)) {
    return null;
  }

  const subMeta = readMeta(subIndex);
  const children: Ordered<ChildModule>[] = [];

  for (const fileName of fs.readdirSync(subPath).filter((name) => name.endsWith('.md') && name !== '_index.md')) {
    const slug = fileName.replace(/\.md$/, '');
    const contentPath = [...contentPathPrefix, rootDir, ...parentPath, subDir, fileName].join('/');
    children.push(loadChildArticle(path.join(subPath, fileName), slug, contentPath));
  }

  children.sort((left, right) => left.order - right.order);

  return {
    order: asNumber(subMeta.order, 99),
    module: {
      id: `sub-${scopedId(nodeIdPrefix, [rootDir, ...parentPath, subDir])}`,
      title: asString(subMeta.title, subDir),
      category: 'Sub-module',
      color: COLORS.white,
      description: asString(subMeta.description, ''),
      tags: asStringArray(subMeta.tags),
      children: children.map((entry) => entry.module),
    },
  };
}

function loadGroupModuleFromBase(
  baseDir: string,
  contentPathPrefix: string[],
  nodeIdPrefix: string,
  rootDir: string,
  groupDir: string,
): Ordered<GroupModule> | null {
  const groupPath = path.join(baseDir, rootDir, groupDir);
  const groupIndex = path.join(groupPath, '_index.md');

  if (!exists(groupIndex)) {
    return null;
  }

  const groupMeta = readMeta(groupIndex);
  const subs: Ordered<SubModule>[] = [];

  for (const subDir of dirs(groupPath)) {
    const loaded = loadSubModuleFromBase(baseDir, contentPathPrefix, nodeIdPrefix, rootDir, [groupDir], subDir);
    if (loaded) {
      subs.push(loaded);
    }
  }

  subs.sort((left, right) => left.order - right.order);

  return {
    order: asNumber(groupMeta.order, 99),
    module: {
      id: `group-${scopedId(nodeIdPrefix, [rootDir, groupDir])}`,
      title: asString(groupMeta.title, groupDir),
      category: 'Group',
      color: COLORS.white,
      description: asString(groupMeta.description, ''),
      tags: asStringArray(groupMeta.tags),
      subs: subs.map((entry) => entry.module),
    },
  };
}

function loadRootModulesFromBase(baseDir: string, contentPathPrefix: string[], nodeIdPrefix: string): RootModule[] {
  if (!exists(baseDir)) {
    return [];
  }

  const roots: Ordered<RootModule>[] = [];

  for (const rootDir of dirs(baseDir)) {
    const rootPath = path.join(baseDir, rootDir);
    const indexFile = path.join(rootPath, '_index.md');

    if (!exists(indexFile)) {
      continue;
    }

    const rootMeta = readMeta(indexFile);
    const rootChildren: Ordered<RootChild>[] = [];

    for (const fileName of fs.readdirSync(rootPath).filter((name) => name.endsWith('.md') && name !== '_index.md')) {
      const slug = fileName.replace(/\.md$/, '');
      const contentPath = [...contentPathPrefix, rootDir, fileName].join('/');
      rootChildren.push(loadChildArticle(path.join(rootPath, fileName), slug, contentPath));
    }

    for (const childDir of dirs(rootPath)) {
      const childPath = path.join(rootPath, childDir);
      const childIndex = path.join(childPath, '_index.md');

      if (!exists(childIndex)) {
        continue;
      }

      if (hasArticles(childPath)) {
        const sub = loadSubModuleFromBase(baseDir, contentPathPrefix, nodeIdPrefix, rootDir, [], childDir);
        if (sub) {
          rootChildren.push(sub);
        }
      } else if (hasNestedSubs(childPath)) {
        const group = loadGroupModuleFromBase(baseDir, contentPathPrefix, nodeIdPrefix, rootDir, childDir);
        if (group) {
          rootChildren.push(group);
        }
      }
    }

    rootChildren.sort((left, right) => left.order - right.order);

    roots.push({
      order: asNumber(rootMeta.order, 99),
      module: {
        id: `root-${scopedId(nodeIdPrefix, [rootDir])}`,
        title: asString(rootMeta.title, rootDir),
        category: 'Root Module',
        color: COLORS.coral,
        icon: asString(rootMeta.icon, 'BookOpen'),
        description: asString(rootMeta.description, ''),
        tags: asStringArray(rootMeta.tags),
        subs: rootChildren.map((entry) => entry.module),
      },
    });
  }

  roots.sort((left, right) => left.order - right.order);
  roots.forEach((entry, index) => {
    entry.module.color = getRoadmapAccentColor(index);
  });

  return roots.map((entry) => entry.module);
}

function readRoadmapBase(slug: string): Omit<RoadmapSummary, 'rootCount' | 'articleCount'> | null {
  const roadmapIndex = path.join(ROOT_DIR, 'roadmaps', slug, '_index.md');

  if (!exists(roadmapIndex)) {
    return null;
  }

  const meta = readMeta(roadmapIndex);
  const category = isRoadmapCategory(meta.category) ? meta.category : 'career';

  return {
    id: asString(meta.id, `roadmap-${slug}`),
    slug,
    title: asString(meta.title, slug),
    description: asString(meta.description, ''),
    category,
    tags: asStringArray(meta.tags),
    icon: asString(meta.icon, 'Map'),
    order: asNumber(meta.order, 99),
    available: asBoolean(meta.available, true),
  };
}

function loadRoadmapFromDirectory(slug: string): Roadmap | null {
  const roadmapDir = path.join(ROOT_DIR, 'roadmaps', slug);
  const modulesDir = path.join(roadmapDir, 'modules');
  const indexFile = path.join(roadmapDir, '_index.md');

  if (!exists(indexFile)) {
    return null;
  }

  const hasModulesDir = exists(modulesDir);
  const rootBaseDir = hasModulesDir ? modulesDir : roadmapDir;
  const contentPathPrefix = hasModulesDir ? ['roadmaps', slug, 'modules'] : ['roadmaps', slug];
  const roots = loadRootModulesFromBase(rootBaseDir, contentPathPrefix, slug);
  const base = readRoadmapBase(slug);

  return base ? createRoadmap(base, roots) : null;
}

function loadExplicitRoadmaps(): Roadmap[] {
  const roadmapsDir = path.join(ROOT_DIR, 'roadmaps');

  if (!exists(roadmapsDir)) {
    return [];
  }

  return dirs(roadmapsDir)
    .map(loadRoadmapFromDirectory)
    .filter((roadmap): roadmap is Roadmap => roadmap !== null);
}

function loadLegacyDefaultRoadmap(): Roadmap | null {
  const roots = loadRoadmapData();

  return roots.length > 0 ? createDefaultRoadmap(roots) : null;
}

function loadRoadmaps(): Roadmap[] {
  const legacyRoadmap = loadLegacyDefaultRoadmap();
  const roadmaps = [
    ...(legacyRoadmap ? [legacyRoadmap] : []),
    ...loadExplicitRoadmaps(),
  ];

  return appendMissingPlannedRoadmaps(roadmaps);
}

const CHALLENGES_ROOT = path.join(ROOT_DIR, 'challenges');

function safeReaddir(dir: string): string[] {
  if (!exists(dir)) {
    return [];
  }

  return fs.readdirSync(dir);
}

function isDir(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function loadCategories(): ChallengeCategoryMeta[] {
  const result: ChallengeCategoryMeta[] = [];

  for (const name of safeReaddir(CHALLENGES_ROOT)) {
    const dir = path.join(CHALLENGES_ROOT, name);
    if (!isDir(dir)) {
      continue;
    }

    const indexPath = path.join(dir, '_index.md');
    if (!exists(indexPath)) {
      continue;
    }

    const { data } = readMatter(indexPath);

    result.push({
      id: name,
      title: asString(data.title, name),
      description: asString(data.description, ''),
      kind: asString(data.kind, 'other'),
      icon: asString(data.icon, 'Terminal'),
      color: asString(data.color, COLORS.aqua),
      order: asNumber(data.order, 999),
      available: asBoolean(data.available, true),
    });
  }

  return result.sort((left, right) => left.order - right.order);
}

function listStepDirs(groupDir: string): string[] {
  return safeReaddir(groupDir)
    .filter((name) => {
      const stepDir = path.join(groupDir, name);
      return isDir(stepDir) && exists(path.join(stepDir, 'challenge.md'));
    })
    .sort();
}

function loadStep(groupDir: string, stepId: string): ChallengeStep | null {
  const stepDir = path.join(groupDir, stepId);
  const challengePath = path.join(stepDir, 'challenge.md');
  const configPath = path.join(stepDir, 'config.json');
  const quizPath = path.join(stepDir, 'quiz.json');
  const editorPath = path.join(stepDir, 'editor.json');

  if (!exists(challengePath) || (!exists(configPath) && !exists(quizPath) && !exists(editorPath))) {
    return null;
  }

  const parsed = readMatter(challengePath);
  const solutionPath = path.join(stepDir, 'solution.md');
  const hintsPath = path.join(stepDir, 'hints.md');
  const solution = exists(solutionPath) ? fs.readFileSync(solutionPath, 'utf-8') : '';
  const hintsRaw = exists(hintsPath) ? fs.readFileSync(hintsPath, 'utf-8') : '';

  const base = {
    id: stepId,
    title: asString(parsed.data.title, stepId),
    sectionSlug: asOptionalString(parsed.data.sectionSlug),
    order: asNumber(parsed.data.order, 999),
    description: parsed.content,
    solution,
    hints: hintsRaw
      .split(/\n---+\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  };

  if (exists(quizPath)) {
    return {
      ...base,
      kind: 'quiz',
      quiz: JSON.parse(fs.readFileSync(quizPath, 'utf-8')) as QuizConfig,
    };
  }

  if (exists(editorPath)) {
    return {
      ...base,
      kind: 'editor',
      editor: JSON.parse(fs.readFileSync(editorPath, 'utf-8')) as EditorConfig,
    };
  }

  return {
    ...base,
    kind: 'practical',
    config: JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ChallengeConfig,
  };
}

function loadGroupsForCategory(categoryId: string): ChallengeGroupMeta[] {
  const dir = path.join(CHALLENGES_ROOT, categoryId);
  const result: ChallengeGroupMeta[] = [];

  for (const name of safeReaddir(dir)) {
    const groupDir = path.join(dir, name);
    if (!isDir(groupDir)) {
      continue;
    }

    const indexPath = path.join(groupDir, '_index.md');
    if (!exists(indexPath)) {
      continue;
    }

    const parsed = readMatter(indexPath);
    const steps = listStepDirs(groupDir);

    result.push({
      id: name,
      title: asString(parsed.data.title, name),
      description: asString(parsed.data.description, parsed.content.trim()),
      difficulty: asString(parsed.data.difficulty, 'easy'),
      order: asNumber(parsed.data.order, 999),
      articleId: asOptionalString(parsed.data.articleId),
      articleSlug: asOptionalString(parsed.data.articleSlug),
      practiceOnly: asBoolean(parsed.data.practiceOnly, false),
      tags: asStringArray(parsed.data.tags),
      category: categoryId,
      stepCount: steps.length,
    });
  }

  return result.sort((left, right) => left.order - right.order);
}

function loadGroup(categoryId: string, groupId: string): ChallengeGroupFull | null {
  const groupDir = path.join(CHALLENGES_ROOT, categoryId, groupId);
  const indexPath = path.join(groupDir, '_index.md');

  if (!exists(indexPath)) {
    return null;
  }

  const parsed = readMatter(indexPath);
  const steps = listStepDirs(groupDir)
    .map((stepId) => loadStep(groupDir, stepId))
    .filter((step): step is ChallengeStep => step !== null)
    .sort((left, right) => left.order - right.order);

  return {
    id: groupId,
    title: asString(parsed.data.title, groupId),
    description: asString(parsed.data.description, parsed.content.trim()),
    difficulty: asString(parsed.data.difficulty, 'easy'),
    order: asNumber(parsed.data.order, 999),
    articleId: asOptionalString(parsed.data.articleId),
    articleSlug: asOptionalString(parsed.data.articleSlug),
    practiceOnly: asBoolean(parsed.data.practiceOnly, false),
    tags: asStringArray(parsed.data.tags),
    category: categoryId,
    stepCount: steps.length,
    steps,
  };
}

function buildSectionPracticeMap(
  articleId: string,
  categories: ChallengeCategoryMeta[],
  groupsByCategory: Record<string, ChallengeGroupMeta[]>,
): Record<string, SectionPracticeLink[]> {
  const map: Record<string, SectionPracticeLink[]> = {};

  for (const category of categories) {
    if (!category.available) {
      continue;
    }

    for (const meta of groupsByCategory[category.id] ?? []) {
      if (meta.articleId !== articleId) {
        continue;
      }

      const full = loadGroup(category.id, meta.id);
      if (!full) {
        continue;
      }

      full.steps.forEach((step, index) => {
        if (!step.sectionSlug) {
          return;
        }

        const bucket = map[step.sectionSlug] ?? [];
        bucket.push({
          category: category.id,
          groupId: meta.id,
          stepId: step.id,
          stepIndex: index,
          stepTitle: step.title,
          groupTitle: meta.title,
          kind: step.kind,
        });
        map[step.sectionSlug] = bucket;
      });
    }
  }

  return map;
}

function walkRoadmapArticles(roadmapData: RootModule[]): string[] {
  const contentPaths: string[] = [];

  for (const root of roadmapData) {
    for (const child of root.subs) {
      if (isRootArticle(child)) {
        contentPaths.push(child.contentPath);
        continue;
      }

      const subs = child.category === 'Group' ? child.subs : [child];

      for (const sub of subs) {
        for (const article of sub.children) {
          contentPaths.push(article.contentPath);
        }
      }
    }
  }

  return contentPaths;
}

function buildArticleCatalog(roadmapData: RootModule[]): ArticleCatalogItem[] {
  const catalog: ArticleCatalogItem[] = [];

  for (const root of roadmapData) {
    for (const child of root.subs) {
      if (isRootArticle(child)) {
        const slug = slugifyTitle(child.title);
        const aliases = new Set<string>();
        aliases.add(slug);
        aliases.add(child.contentPath);
        const legacyGeneratedId = getLegacyGeneratedArticleId(child.contentPath);
        if (legacyGeneratedId) aliases.add(legacyGeneratedId);
        for (const alias of child.aliases ?? []) aliases.add(alias);
        aliases.delete(child.id);

        catalog.push({
          id: child.id,
          title: child.title,
          slug,
          contentPath: child.contentPath,
          aliases: Array.from(aliases).sort(),
        });
        continue;
      }

      const subs = child.category === 'Group' ? child.subs : [child];

      for (const sub of subs) {
        for (const article of sub.children) {
          const slug = slugifyTitle(article.title);
          const aliases = new Set<string>();
          aliases.add(slug);
          aliases.add(article.contentPath);
          const legacyGeneratedId = getLegacyGeneratedArticleId(article.contentPath);
          if (legacyGeneratedId) aliases.add(legacyGeneratedId);
          for (const alias of article.aliases ?? []) aliases.add(alias);
          aliases.delete(article.id);

          catalog.push({
            id: article.id,
            title: article.title,
            slug,
            contentPath: article.contentPath,
            aliases: Array.from(aliases).sort(),
          });
        }
      }
    }
  }

  return catalog.sort((left, right) => left.id.localeCompare(right.id));
}

const CHALLENGE_ARTICLE_PREFIXES: Record<string, string> = {
  aws: 'cloud-providers/aws/',
  azure: 'cloud-providers/azure/',
  gcp: 'cloud-providers/gcp/',
  cicd: 'cicd/',
  linux: 'devops-foundation/linux/',
  networking: 'devops-foundation/networking/',
  rust: 'roadmaps/rust/',
};

function articleMatchesKey(article: ArticleCatalogItem, key: string): boolean {
  return article.id === key
    || article.slug === key
    || article.contentPath === key
    || article.aliases.includes(key);
}

type ChallengeArticleResolution =
  | { status: 'resolved'; articleId?: string }
  | { status: 'skipped'; reason: string };

function resolveChallengeArticleLink(group: ChallengeGroupMeta, catalog: ArticleCatalogItem[]): ChallengeArticleResolution {
  const articleKey = group.articleId ?? group.articleSlug;

  if (!articleKey) {
    return { status: 'resolved' };
  }

  const matches = catalog.filter((article) => articleMatchesKey(article, articleKey));
  const categoryPrefix = CHALLENGE_ARTICLE_PREFIXES[group.category];
  const scopedMatches = categoryPrefix
    ? matches.filter((article) => article.contentPath?.startsWith(categoryPrefix))
    : matches;
  const candidates = scopedMatches.length > 0 ? scopedMatches : matches;

  if (candidates.length === 1) {
    return { status: 'resolved', articleId: candidates[0].id };
  }

  if (candidates.length > 1) {
    return { status: 'skipped', reason: `ambiguous article key ${articleKey}. Add articleId.` };
  }

  return { status: 'skipped', reason: `unknown article key ${articleKey}` };
}

function resolveArticleIdsForGroups(
  groupsByCategory: Record<string, ChallengeGroupMeta[]>,
  catalog: ArticleCatalogItem[],
): Record<string, ChallengeGroupMeta[]> {
  const skippedGroups: string[] = [];
  const resolvedGroupsByCategory = Object.fromEntries(
    Object.entries(groupsByCategory).map(([categoryId, groups]) => [
      categoryId,
      groups.flatMap((group) => {
        const resolution = resolveChallengeArticleLink(group, catalog);

        if (resolution.status === 'skipped') {
          skippedGroups.push(`${group.category}/${group.id}: ${resolution.reason}`);
          return [];
        }

        return resolution.articleId ? [{ ...group, articleId: resolution.articleId }] : [group];
      }),
    ]),
  );

  if (skippedGroups.length > 0) {
    console.warn([
      `Skipping ${skippedGroups.length} challenge group(s) with unresolved article links:`,
      ...skippedGroups.map((group) => `- ${group}`),
    ].join('\n'));
  }

  return resolvedGroupsByCategory;
}

function writeArticleArtifacts(versionRoot: string, roadmapData: RootModule[]): void {
  for (const contentPath of walkRoadmapArticles(roadmapData)) {
    const sourcePath = path.join(ROOT_DIR, contentPath);
    const targetPath = path.join(versionRoot, 'articles', contentPath);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function writeContentAssets(): void {
  const sourcePath = path.join(ROOT_DIR, 'content-assets');

  if (!exists(sourcePath)) {
    return;
  }

  fs.cpSync(sourcePath, path.join(DIST_ROOT, 'content-assets'), { recursive: true });
}

function writeGroupArtifacts(
  versionRoot: string,
  categories: ChallengeCategoryMeta[],
  groupsByCategory: Record<string, ChallengeGroupMeta[]>,
): void {
  for (const category of categories) {
    for (const group of groupsByCategory[category.id] ?? []) {
      const fullGroup = loadGroup(category.id, group.id);

      if (!fullGroup) {
        continue;
      }

      writeJson(path.join(versionRoot, 'groups', category.id, `${group.id}.json`), {
        ...fullGroup,
        articleId: group.articleId,
      });
    }
  }
}

function buildManifest(): Manifest {
  const roadmaps = loadRoadmaps();
  const roadmapData = roadmaps.find((roadmap) => roadmap.slug === DEFAULT_ROADMAP_SLUG)?.roots ?? roadmaps[0]?.roots ?? [];
  const allRoadmapData = roadmaps.flatMap((roadmap) => roadmap.roots);
  const articleCatalog = buildArticleCatalog(allRoadmapData);
  const categories = loadCategories();
  const rawGroupsByCategory = Object.fromEntries(
    categories.map((category) => [category.id, loadGroupsForCategory(category.id)]),
  );
  const groupsByCategory = resolveArticleIdsForGroups(rawGroupsByCategory, articleCatalog);

  const groupsByArticle: Record<string, ChallengeGroupMeta[]> = {};
  const groupsByArticleId: Record<string, ChallengeGroupMeta[]> = {};
  const articleSlugs = new Set<string>();
  const articleIds = new Set<string>();

  for (const category of categories) {
    if (!category.available) {
      continue;
    }

    for (const group of groupsByCategory[category.id] ?? []) {
      if (group.articleSlug) {
        const bucket = groupsByArticle[group.articleSlug] ?? [];
        bucket.push(group);
        groupsByArticle[group.articleSlug] = bucket;
        articleSlugs.add(group.articleSlug);
      }

      if (group.articleId) {
        const bucket = groupsByArticleId[group.articleId] ?? [];
        bucket.push(group);
        groupsByArticleId[group.articleId] = bucket;
        articleIds.add(group.articleId);
      }
    }
  }

  const sectionPracticeByArticle: Record<string, Record<string, SectionPracticeLink[]>> = {};
  for (const articleSlug of articleSlugs) {
    const groups = groupsByArticle[articleSlug] ?? [];
    const articleId = groups.find((group) => group.articleId)?.articleId;
    sectionPracticeByArticle[articleSlug] = articleId
      ? buildSectionPracticeMap(articleId, categories, groupsByCategory)
      : {};
  }

  const sectionPracticeByArticleId: Record<string, Record<string, SectionPracticeLink[]>> = {};
  for (const articleId of articleIds) {
    sectionPracticeByArticleId[articleId] = buildSectionPracticeMap(articleId, categories, groupsByCategory);
  }

  return {
    version: VERSION,
    generatedAt: GENERATED_AT,
    articleCatalog,
    roadmapSummaries: roadmaps.map(summarizeRoadmap),
    roadmaps,
    roadmapData,
    categories,
    groupsByCategory,
    groupsByArticle,
    groupsByArticleId,
    sectionPracticeByArticle,
    sectionPracticeByArticleId,
  };
}

function writeStaticIndex(): void {
  writeText(
    path.join(DIST_ROOT, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dev Roadmaps Content</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
      code { background: #f4f4f5; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Dev Roadmaps Content</h1>
    <p>Latest generated version: <code>${VERSION}</code></p>
    <p>Generated at: <code>${GENERATED_AT}</code></p>
    <p>Manifest pointer: <a href="./live/current.json">live/current.json</a></p>
  </body>
</html>
`,
  );
}

function main(): void {
  fs.rmSync(DIST_ROOT, { recursive: true, force: true });

  const manifest = buildManifest();
  const versionRoot = path.join(DIST_ROOT, 'versions', VERSION);

  writeJson(path.join(DIST_ROOT, 'live', 'current.json'), {
    version: VERSION,
    generatedAt: GENERATED_AT,
  });
  writeJson(path.join(versionRoot, 'manifest.json'), manifest);
  writeGroupArtifacts(versionRoot, manifest.categories, manifest.groupsByCategory);
  writeArticleArtifacts(versionRoot, manifest.roadmaps.flatMap((roadmap) => roadmap.roots));
  writeContentAssets();
  writeText(path.join(DIST_ROOT, '.nojekyll'), '');
  writeStaticIndex();

  console.log(`Built content artifacts for version ${VERSION}`);
}

main();
