import type { SkillCategory } from './enums';

/**
 * Skill taxonomy used for deterministic skill detection (resume heuristics,
 * job requirement extraction) and normalization (aliases → canonical key).
 * The AI parser can surface skills outside this list; they are kept as-is.
 */
interface SkillDef {
  name: string;
  category: SkillCategory;
  aliases?: string[];
}

const DEFS: SkillDef[] = [
  // Programming languages
  { name: 'JavaScript', category: 'PROGRAMMING_LANGUAGE', aliases: ['js', 'ecmascript', 'es6'] },
  { name: 'TypeScript', category: 'PROGRAMMING_LANGUAGE', aliases: ['ts'] },
  { name: 'Python', category: 'PROGRAMMING_LANGUAGE', aliases: ['python3', 'py'] },
  { name: 'Java', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'C#', category: 'PROGRAMMING_LANGUAGE', aliases: ['csharp', 'c sharp'] },
  { name: 'C++', category: 'PROGRAMMING_LANGUAGE', aliases: ['cpp'] },
  { name: 'C', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'Go', category: 'PROGRAMMING_LANGUAGE', aliases: ['golang'] },
  { name: 'Rust', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'Ruby', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'PHP', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'Kotlin', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'Swift', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'Scala', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'R', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'SQL', category: 'PROGRAMMING_LANGUAGE' },
  { name: 'Bash', category: 'PROGRAMMING_LANGUAGE', aliases: ['shell scripting', 'shell'] },
  { name: 'Dart', category: 'PROGRAMMING_LANGUAGE' },
  // Frameworks / libraries
  { name: 'React', category: 'FRAMEWORK', aliases: ['react.js', 'reactjs'] },
  { name: 'Next.js', category: 'FRAMEWORK', aliases: ['nextjs', 'next'] },
  { name: 'Angular', category: 'FRAMEWORK', aliases: ['angularjs', 'angular.js'] },
  { name: 'Vue', category: 'FRAMEWORK', aliases: ['vue.js', 'vuejs'] },
  { name: 'Svelte', category: 'FRAMEWORK' },
  { name: 'Node.js', category: 'FRAMEWORK', aliases: ['node', 'nodejs'] },
  { name: 'Express', category: 'FRAMEWORK', aliases: ['express.js', 'expressjs'] },
  { name: 'NestJS', category: 'FRAMEWORK', aliases: ['nest.js', 'nest'] },
  { name: 'Django', category: 'FRAMEWORK' },
  { name: 'Flask', category: 'FRAMEWORK' },
  { name: 'FastAPI', category: 'FRAMEWORK' },
  { name: 'Spring Boot', category: 'FRAMEWORK', aliases: ['spring', 'springboot'] },
  { name: 'Hibernate', category: 'FRAMEWORK' },
  { name: '.NET', category: 'FRAMEWORK', aliases: ['dotnet', 'asp.net', '.net core'] },
  { name: 'Ruby on Rails', category: 'FRAMEWORK', aliases: ['rails'] },
  { name: 'Laravel', category: 'FRAMEWORK' },
  { name: 'Flutter', category: 'FRAMEWORK' },
  { name: 'React Native', category: 'FRAMEWORK' },
  { name: 'TensorFlow', category: 'FRAMEWORK' },
  { name: 'PyTorch', category: 'FRAMEWORK' },
  { name: 'Pandas', category: 'FRAMEWORK' },
  { name: 'NumPy', category: 'FRAMEWORK' },
  { name: 'scikit-learn', category: 'FRAMEWORK', aliases: ['sklearn'] },
  { name: 'Apache Spark', category: 'FRAMEWORK', aliases: ['spark', 'pyspark'] },
  { name: 'Kafka', category: 'TOOL', aliases: ['apache kafka'] },
  { name: 'Airflow', category: 'TOOL', aliases: ['apache airflow'] },
  { name: 'GraphQL', category: 'TECHNICAL' },
  { name: 'REST APIs', category: 'TECHNICAL', aliases: ['rest', 'restful', 'rest api', 'restful apis'] },
  { name: 'Microservices', category: 'TECHNICAL', aliases: ['microservice'] },
  { name: 'Tailwind CSS', category: 'FRAMEWORK', aliases: ['tailwind'] },
  { name: 'HTML', category: 'TECHNICAL', aliases: ['html5'] },
  { name: 'CSS', category: 'TECHNICAL', aliases: ['css3'] },
  { name: 'Redux', category: 'FRAMEWORK' },
  // Databases
  { name: 'PostgreSQL', category: 'DATABASE', aliases: ['postgres', 'psql'] },
  { name: 'MySQL', category: 'DATABASE' },
  { name: 'MongoDB', category: 'DATABASE', aliases: ['mongo'] },
  { name: 'Redis', category: 'DATABASE' },
  { name: 'Elasticsearch', category: 'DATABASE', aliases: ['elastic search', 'opensearch'] },
  { name: 'Oracle', category: 'DATABASE', aliases: ['oracle db'] },
  { name: 'SQL Server', category: 'DATABASE', aliases: ['mssql', 'ms sql'] },
  { name: 'DynamoDB', category: 'DATABASE' },
  { name: 'Cassandra', category: 'DATABASE' },
  { name: 'SQLite', category: 'DATABASE' },
  { name: 'Snowflake', category: 'DATABASE' },
  { name: 'BigQuery', category: 'DATABASE' },
  // Cloud & DevOps
  { name: 'AWS', category: 'CLOUD', aliases: ['amazon web services'] },
  { name: 'Azure', category: 'CLOUD', aliases: ['microsoft azure'] },
  { name: 'GCP', category: 'CLOUD', aliases: ['google cloud', 'google cloud platform'] },
  { name: 'Docker', category: 'TOOL' },
  { name: 'Kubernetes', category: 'TOOL', aliases: ['k8s'] },
  { name: 'Terraform', category: 'TOOL' },
  { name: 'Ansible', category: 'TOOL' },
  { name: 'Jenkins', category: 'TOOL' },
  { name: 'GitHub Actions', category: 'TOOL' },
  { name: 'CI/CD', category: 'TECHNICAL', aliases: ['ci cd', 'continuous integration'] },
  { name: 'Linux', category: 'TOOL' },
  { name: 'Git', category: 'TOOL' },
  { name: 'Jira', category: 'TOOL' },
  { name: 'Lambda', category: 'CLOUD', aliases: ['aws lambda'] },
  { name: 'Machine Learning', category: 'TECHNICAL', aliases: ['ml'] },
  { name: 'Data Engineering', category: 'TECHNICAL' },
  { name: 'ETL', category: 'TECHNICAL' },
  { name: 'System Design', category: 'TECHNICAL' },
  { name: 'Unit Testing', category: 'TECHNICAL', aliases: ['tdd', 'jest', 'junit', 'pytest'] },
  // Soft skills
  { name: 'Communication', category: 'SOFT', aliases: ['communication skills'] },
  { name: 'Leadership', category: 'SOFT', aliases: ['team leadership'] },
  { name: 'Teamwork', category: 'SOFT', aliases: ['collaboration', 'team player'] },
  { name: 'Problem Solving', category: 'SOFT', aliases: ['problem-solving'] },
  { name: 'Mentoring', category: 'SOFT', aliases: ['mentorship'] },
  { name: 'Agile', category: 'SOFT', aliases: ['scrum', 'kanban'] },
  { name: 'Project Management', category: 'SOFT' },
  { name: 'Stakeholder Management', category: 'SOFT' },
];

export function normalizeSkillKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-•·*,;:]+|[\s\-•·*,;:.]+$/g, '')
    .trim();
}

const ALIAS_INDEX = new Map<string, SkillDef>();
for (const def of DEFS) {
  ALIAS_INDEX.set(normalizeSkillKey(def.name), def);
  for (const a of def.aliases ?? []) ALIAS_INDEX.set(normalizeSkillKey(a), def);
}

/** Canonical display name + category for a raw skill string. Unknown skills keep their own name. */
export function canonicalizeSkill(raw: string): { name: string; key: string; category: SkillCategory; known: boolean } {
  const key = normalizeSkillKey(raw);
  const def = ALIAS_INDEX.get(key);
  if (def) return { name: def.name, key: normalizeSkillKey(def.name), category: def.category, known: true };
  return { name: raw.trim(), key, category: 'OTHER', known: false };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Very short aliases (e.g. "c", "r", "go", "js") produce false positives in free text;
// they are only matched when they appear in an explicit skills list, not in prose.
const AMBIGUOUS = new Set(['c', 'r', 'go', 'next', 'node', 'nest', 'spring', 'shell', 'rest', 'ml', 'ts', 'py', 'js', 'mongo', 'spark', 'oracle', 'rails', 'tailwind', 'jest', 'scrum', 'kanban', 'collaboration', 'communication', 'leadership']);

const PATTERNS: { def: SkillDef; re: RegExp }[] = [];
for (const def of DEFS) {
  for (const term of [def.name, ...(def.aliases ?? [])]) {
    const k = normalizeSkillKey(term);
    if (AMBIGUOUS.has(k)) continue;
    // Word-ish boundaries that tolerate symbols like C++, C#, .NET, Node.js
    PATTERNS.push({ def, re: new RegExp(`(^|[^a-z0-9+#])${escapeRegex(k)}(?=$|[^a-z0-9+#])`, 'i') });
  }
}

/** Deterministically detect known skills mentioned in free text. */
export function detectSkillsInText(text: string): { name: string; category: SkillCategory }[] {
  const lower = text.toLowerCase();
  const found = new Map<string, SkillCategory>();
  for (const { def, re } of PATTERNS) {
    if (!found.has(def.name) && re.test(lower)) found.set(def.name, def.category);
  }
  return [...found.entries()].map(([name, category]) => ({ name, category }));
}

export const KNOWN_SKILLS: readonly string[] = DEFS.map((d) => d.name);
