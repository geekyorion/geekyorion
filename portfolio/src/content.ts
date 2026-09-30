/** Single source of truth for the page sections and the terminal. */

export const PROFILE = {
  name: 'Shashank Sharma',
  handle: 'geekyorion',
  role: 'Specialist Programmer @ Infosys',
  location: 'Reading, United Kingdom',
  since: 2018,
  email: 'shashank.intmax@gmail.com',
  bio:
    'Front-end engineer who likes the hard parts: micro-frontend architecture, build pipelines, ' +
    'accessibility, and pushing pixels through the GPU. React, Angular & TypeScript by day, ' +
    'shaders and creative coding by night.',
  focus: ['React', 'Angular', 'TypeScript', 'Micro-frontends', 'WebGL / WebGPU'],
  interests: ['Chess (aiming for a FIDE rating)', 'Sudoku', 'Lo-fi music'],
};

export const LINKS = [
  { label: 'GitHub', href: 'https://github.com/geekyorion', cmd: 'github' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/geekyorion/', cmd: 'linkedin' },
  { label: 'Medium', href: 'https://geekyorion.medium.com', cmd: 'medium' },
  { label: 'npm', href: 'https://www.npmjs.com/~geekyorion', cmd: 'npm' },
  { label: 'HackerRank', href: 'https://www.hackerrank.com/geekyorion', cmd: 'hackerrank' },
  { label: 'X / Twitter', href: 'https://twitter.com/geekyorion_', cmd: 'twitter' },
  { label: 'Resume', href: 'https://geekyorion.github.io/resume', cmd: 'resume' },
];

export interface Commit {
  hash: string;
  type: string;
  scope: string;
  title: string;
  lines: string[];
  tags: string[];
  branch?: string;
  award?: string;
}

/** Experience, told as a git history (newest first). */
export const COMMITS: Commit[] = [
  {
    hash: 'a1f3e9c', type: 'feat', scope: 'sse', branch: 'HEAD -> main',
    title: 'Lead UI across 6 concurrent Next.js platforms',
    lines: [
      'Led UI development for six concurrent Next.js + Contentful projects, owning team workflow and code standards',
      'Wired services into New Relic for monitoring and performance tracking',
      'Ran security audits and vulnerability assessments with SonarQube',
    ],
    tags: ['Next.js', 'Azure', 'Contentful', 'New Relic', 'ServiceNow'],
  },
  {
    hash: '7c02b4d', type: 'refactor', scope: 'citizens-bank',
    title: 'Break a monolith into Single-SPA micro-frontends',
    lines: [
      'Migrated a legacy monolith to MFEs: modular deploys, independent scaling',
      'Built a custom ng-library for robust inter-MFE communication',
      'Cut overall build time by 60% through modularisation and automation',
    ],
    tags: ['Angular', 'Single-SPA', 'OpenShift', 'Jenkins', 'Datadog'],
  },
  {
    hash: 'e4d91aa', type: 'feat', scope: 'allstate', award: 'Eureka award',
    title: 'Automate session auth-token generation',
    lines: [
      'Standalone web app that automates and generates auth tokens for sessions',
      'Logic-less UI rendered dynamically from backend contracts',
    ],
    tags: ['React', 'MFE', 'MongoDB', 'Jenkins'],
  },
  {
    hash: '3b8f6e1', type: 'feat', scope: 'kraft-heinz', award: 'Best Young Developer',
    title: 'Ship three apps for high-sensitivity sales data',
    lines: [
      'Designed, built and deployed three web apps for the sales organisation',
      'Raised user-experience scores by 55%',
    ],
    tags: ['Angular', 'TypeScript', 'Azure'],
  },
  {
    hash: '91c7d20', type: 'perf', scope: 'airbus',
    title: 'Handle millions of records without breaking a sweat',
    lines: [
      'Accessible, high-performance app managing millions of data entries',
      'Lightweight Express server for internal operations',
    ],
    tags: ['React', 'Redux', 'Express', 'MongoDB'],
  },
  {
    hash: '5e2a0f7', type: 'fix', scope: 'apple', branch: 'tag: systems-engineer',
    title: 'Make web components WCAG compliant',
    lines: [
      'Improved accessibility across many web components for an inclusive UX',
      'Upgraded legacy Mustache-template components to a modern stack',
    ],
    tags: ['React', 'ReconJS', 'SCSS', 'a11y'],
  },
  {
    hash: '0000001', type: 'chore', scope: 'init', branch: 'tag: v1.0-btech',
    title: 'B.Tech (Hons.) - Poornima Group of Institutions, Jaipur',
    lines: ['2014 - 2018 · 78.93% (Hons.)', 'Smart India Hackathon finalist'],
    tags: ['C', 'Unity', 'AR'],
  },
];

export interface Project {
  name: string;
  kind: string;
  desc: string;
  tech: string[];
  links: { label: string; href: string }[];
  featured?: boolean;
}

export const PROJECTS: Project[] = [
  {
    name: 'Lucent / vitreui', kind: 'npm library', featured: true,
    desc: 'Glassmorphic React component library with runtime-adjustable transparency for accessibility. Zero style runtime, per-component tree-shaking, Radix primitives, RTL and SSR safe.',
    tech: ['React 19', 'TypeScript', 'Radix UI', 'pnpm workspaces', 'Changesets'],
    links: [
      { label: 'docs', href: 'https://orionshub.github.io/lucent/' },
      { label: 'npm', href: 'https://www.npmjs.com/package/@orionshub/lucent' },
      { label: 'source', href: 'https://github.com/orionshub/lucent' },
    ],
  },
  {
    name: 'LocalVault', kind: 'desktop app', featured: true,
    desc: 'Privacy-first file organiser with an AES-256-GCM encrypted vault, PIN-gated hidden mode, tags, thumbnails via sharp/ffmpeg, and auto-updates. 100% local.',
    tech: ['Electron', 'React', 'SQLite + Drizzle', 'Playwright', 'Tailwind'],
    links: [],
  },
  {
    name: 'Holographic Terrain', kind: 'webgl', featured: true,
    desc: 'Scroll-driven landing page on a procedural terrain drawn entirely with glowing, chromatic contour lines. Perlin displacement and fwidth anti-aliasing in GLSL.',
    tech: ['Three.js', 'GLSL', 'Perlin noise'],
    links: [
      { label: 'live', href: 'https://geekyorion.github.io/holographic-terrain/' },
      { label: 'source', href: 'https://github.com/geekyorion/holographic-terrain' },
    ],
  },
  {
    name: 'Resume & Portfolio Builder', kind: 'full-stack', featured: true,
    desc: 'One JSON source, two renderers: A4 resumes and interactive portfolios. Monaco-powered live editor, multiple resumes, public /:username profiles.',
    tech: ['React', 'Vite', 'Tailwind v4', 'Zustand', 'Express', 'MongoDB'],
    links: [],
  },
  {
    name: 'JTableau', kind: 'vs code extension',
    desc: 'Opens flat JSON as a sortable, filterable, resizable table right inside VS Code.',
    tech: ['VS Code API', 'React', 'Tabulator'],
    links: [{ label: 'source', href: 'https://github.com/orionshub/json-table-viewer' }],
  },
  {
    name: 'CodeToImage for n8n', kind: 'automation node',
    desc: 'Custom n8n node turning code into crisp, syntax-highlighted PNGs: 200+ languages, 20+ themes, line highlights.',
    tech: ['n8n', 'Shiki', 'Puppeteer', 'TypeScript'],
    links: [],
  },
  {
    name: 'Single-SPA MFE playground', kind: 'architecture',
    desc: 'React and Angular micro-frontends under one root, nested parcels, and RxJS shared state across frameworks.',
    tech: ['Single-SPA', 'Angular', 'React', 'RxJS'],
    links: [{ label: 'source', href: 'https://github.com/orionshub/single-spa-mfe' }],
  },
  {
    name: 'npx geekyorion', kind: 'cli',
    desc: 'A business card in your terminal. Configurable, forkable npx card generator.',
    tech: ['Node', 'chalk', 'boxen'],
    links: [
      { label: 'npm', href: 'https://www.npmjs.com/package/geekyorion' },
      { label: 'source', href: 'https://github.com/geekyorion/geekyorion-npx-card' },
    ],
  },
  {
    name: '@geekyorion/dsa', kind: 'npm library',
    desc: 'Data-structure library for JavaScript: linked lists and friends with a friendly API.',
    tech: ['JavaScript', 'npm'],
    links: [{ label: 'source', href: 'https://github.com/geekyorion/dsalib' }],
  },
  {
    name: 'Ezra & NeoTrade', kind: 'discord bots',
    desc: 'A multipurpose moderation/fun bot with TTS, and a stock-market simulator where servers trade dummy shares.',
    tech: ['discord.js', 'Node', 'MongoDB'],
    links: [{ label: 'neotrade', href: 'https://github.com/orionshub/NeoTrade' }],
  },
  {
    name: 'Creative coding', kind: 'experiments',
    desc: 'Library-free canvas sketches: matrix rain, box collisions, a thousand-particle eye, an audio visualiser.',
    tech: ['Canvas 2D', 'Web Audio', 'canvas-sketch'],
    links: [
      { label: 'raw-js', href: 'https://geekyorion.github.io/creative-coding-raw-js/matrix-effect' },
      { label: 'audio', href: 'https://geekyorion.github.io/Audio-Visualiser/' },
    ],
  },
  {
    name: 'Dev Social Media', kind: 'full-stack',
    desc: 'MERN social network for developers: profiles, posts, experience, education.',
    tech: ['MongoDB', 'Express', 'React', 'Redux'],
    links: [{ label: 'live', href: 'https://geekyorion.github.io/devSocialMedia/' }],
  },
];

export const STACK = [
  { group: 'core', level: 5, items: ['React', 'Angular', 'TypeScript', 'JavaScript', 'HTML', 'CSS'] },
  { group: 'architecture', level: 5, items: ['Micro-frontends', 'Single-SPA', 'Module Federation', 'Next.js', 'Monorepos'] },
  { group: 'graphics', level: 4, items: ['WebGPU', 'WebGL2', 'WGSL', 'GLSL', 'Three.js', 'Canvas'] },
  { group: 'backend', level: 3, items: ['Node', 'Express', 'MongoDB', 'SQL', 'Electron'] },
  { group: 'delivery', level: 4, items: ['Jenkins', 'SonarQube', 'Datadog', 'New Relic', 'Azure', 'OpenShift'] },
];

export const AWARDS = [
  'Infosys MVP (Most Valuable Player) awards',
  'Best Young Developer · Kraft Heinz',
  'Eureka award · Allstate',
  'Smart India Hackathon · finalist',
];

export const CERTS = [
  'freeCodeCamp · Responsive Web Design, JS Algorithms & DS, Front End Libraries',
  'HackerRank · 11 certificates: Angular, React, Node, REST API, JS, Python, Problem Solving',
  'Microsoft 70-480 · Programming in HTML5 with JavaScript and CSS3',
];

export const yearsOfExperience = () => {
  const ms = Date.now() - new Date('2018-10-01').getTime();
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000));
};
