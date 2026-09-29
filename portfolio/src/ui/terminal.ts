import { AWARDS, COMMITS, LINKS, PROFILE, PROJECTS, STACK, yearsOfExperience } from '../content';
import { EXPRESSION_NAMES, type ExpressionName } from '../face/expressions';
import type { ShapeName } from '../scene/shapes';

export interface TermAPI {
  expression(name: ExpressionName): void;
  say(text: string): void;
  talk(seconds: number): void;
  morph(text: string): void;
  shape(name: ShapeName): void;
  face(): void;
  theme(name?: string): string;
  faceStyle(style?: string): string;
  faceStyles: string[];
  themes: string[];
  explode(): void;
  mirror(on: boolean): Promise<void>;
  goto(section: string): void;
  stats(): string;
}

type Line = string | [cls: string, text: string];
type Out = Line[] | Promise<Line[]>;

const SHAPES: ShapeName[] = ['sphere', 'git', 'terrain', 'knot', 'cube'];

export class Terminal {
  private history: string[] = [];
  private hIndex = 0;
  private readonly commands: Record<string, { help: string; run: (args: string[]) => Out; hidden?: boolean }>;
  private booted = false;

  constructor(
    private root: HTMLElement,
    private out: HTMLElement,
    private input: HTMLInputElement,
    private api: TermAPI,
  ) {
    const link = (cmd: string) => () => {
      const l = LINKS.find((x) => x.cmd === cmd)!;
      window.open(l.href, '_blank', 'noopener');
      return [['ok', `opening ${l.href}`]] as Line[];
    };
    this.commands = {
      help: { help: 'list commands', run: () => this.helpText() },
      whoami: {
        help: 'who is this guy?',
        run: () => [
          ['acc', PROFILE.name + ` (@${PROFILE.handle})`],
          `${PROFILE.role} · ${PROFILE.location}`,
          `${yearsOfExperience()} years shipping production front-ends.`,
          ['dim', PROFILE.bio],
        ],
      },
      experience: {
        help: 'git log of my career',
        run: () => {
          this.api.goto('experience');
          return COMMITS.map((c) => [c.award ? 'ok' : '', `${c.hash} ${c.type}(${c.scope}): ${c.title}${c.award ? '  ★ ' + c.award : ''}`] as Line);
        },
      },
      projects: {
        help: 'things I built',
        run: () => {
          this.api.goto('projects');
          return PROJECTS.map((p) => `${p.name.padEnd(28, ' ')} ${p.kind}`);
        },
      },
      stack: {
        help: 'languages, frameworks, tools',
        run: () => {
          this.api.goto('stack');
          return STACK.map((g) => `${g.group.padEnd(13, ' ')} ${'█'.repeat(g.level)}${'░'.repeat(5 - g.level)}  ${g.items.join(', ')}`);
        },
      },
      awards: { help: 'shiny things', run: () => AWARDS.map((a) => ['ok', '★ ' + a] as Line) },
      contact: {
        help: 'ways to reach me',
        run: () => {
          this.api.goto('contact');
          return [`email      ${PROFILE.email}`, ...LINKS.map((l) => `${l.label.padEnd(10, ' ')} ${l.href}`)];
        },
      },
      social: { help: 'alias of contact', run: (a) => this.commands.contact.run(a), hidden: true },
      ...Object.fromEntries(LINKS.map((l) => [l.cmd, { help: `open ${l.label}`, run: link(l.cmd), hidden: true }])),
      face: {
        help: `face <${EXPRESSION_NAMES.join('|')}>`,
        run: ([name]) => {
          if (!name) { this.api.face(); return [['ok', 'particles → face']]; }
          if (!EXPRESSION_NAMES.includes(name as ExpressionName)) return [['err', `unknown expression "${name}". try: ${EXPRESSION_NAMES.join(', ')}`]];
          this.api.face();
          this.api.expression(name as ExpressionName);
          return [['ok', `face.set('${name}')`]];
        },
      },
      ...Object.fromEntries(EXPRESSION_NAMES.map((e) => [e, { help: `make me ${e}`, hidden: true, run: () => this.commands.face.run([e]) }])),
      say: {
        help: 'say <text>: I will say it',
        run: (args) => {
          const t = args.join(' ') || 'hello, world!';
          this.api.say(t);
          return [['acc', `🗨  "${t}"`]];
        },
      },
      morph: {
        help: 'morph <text>: particles become your text',
        run: (args) => {
          const t = args.join(' ').replace(/\\n/g, '\n').slice(0, 40) || 'hello()';
          this.api.morph(t);
          return [['ok', `morphing particles into "${t}". type \`face\` to come back`]];
        },
      },
      shape: {
        help: `shape <${SHAPES.join('|')}>`,
        run: ([name]) => {
          if (!SHAPES.includes(name as ShapeName)) return [['err', `shapes: ${SHAPES.join(', ')}`]];
          this.api.shape(name as ShapeName);
          return [['ok', `particles → ${name}`]];
        },
      },
      style: {
        help: `style [${this.api.faceStyles.join('|')}]: switch face style`,
        run: ([name]) => {
          if (name && !this.api.faceStyles.includes(name)) return [['err', `styles: ${this.api.faceStyles.join(', ')}`]];
          return [['ok', `face style: ${this.api.faceStyle(name)}`]];
        },
      },
      theme: {
        help: `theme [${this.api.themes.join('|')}]`,
        run: ([name]) => {
          if (name && !this.api.themes.includes(name)) return [['err', `themes: ${this.api.themes.join(', ')}`]];
          return [['ok', `theme: ${this.api.theme(name)}`]];
        },
      },
      explode: { help: 'big bang', run: () => { this.api.explode(); return [['acc', '💥']]; } },
      mirror: {
        help: 'mirror [off]: drive my face with your webcam',
        run: async ([arg]) => {
          try {
            await this.api.mirror(arg !== 'off');
            return [['ok', arg === 'off' ? 'mirror off' : 'mirror on: your expressions now drive my face (on-device, nothing uploaded)']];
          } catch (e) {
            return [['err', `mirror failed: ${(e as Error).message}`]];
          }
        },
      },
      stats: { help: 'renderer + particle stats', run: () => [['acc', this.api.stats()]] },
      goto: {
        help: 'goto <section>',
        run: ([s]) => { this.api.goto(s ?? 'hero'); return []; },
        hidden: true,
      },
      ls: {
        help: 'list files',
        hidden: true,
        run: () => [['acc', 'about.md  experience.log  projects/  stack.json  contact.vcf  .secrets']],
      },
      cat: {
        help: 'cat <file>',
        hidden: true,
        run: ([f]) => {
          const map: Record<string, string> = { 'about.md': 'whoami', 'experience.log': 'experience', 'stack.json': 'stack', 'contact.vcf': 'contact' };
          if (f === '.secrets') { this.api.expression('skeptic'); return [['err', 'nice try 🤨']]; }
          return map[f] ? this.commands[map[f]].run([]) : [['err', `cat: ${f ?? ''}: No such file`]];
        },
      },
      npx: {
        help: 'npx geekyorion',
        hidden: true,
        run: ([pkg]) => (pkg === 'geekyorion' ? this.commands.contact.run([]) : [['err', `npm ERR! 404 '${pkg ?? ''}' is not in this registry`]]),
      },
      sudo: { help: '', hidden: true, run: () => { this.api.expression('angry'); return [['err', 'guest is not in the sudoers file. This incident will be reported.']]; } },
      hire: { help: 'the best command', hidden: true, run: () => { this.api.expression('laugh'); this.api.goto('contact'); return [['ok', `let's talk → ${PROFILE.email}`]]; } },
      clear: { help: 'clear the screen', run: () => { this.out.innerHTML = ''; return []; } },
      exit: { help: 'close the terminal', run: () => { this.toggle(false); return []; } },
    };

    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('click', () => this.input.focus());
  }

  get open() { return !this.root.hidden; }

  toggle(force?: boolean) {
    const show = force ?? this.root.hidden;
    this.root.hidden = !show;
    if (show) {
      if (!this.booted) {
        this.booted = true;
        this.print([
          ['acc', `geekyorion-sh v1.0 · ${this.api.stats()}`],
          ['dim', "type 'help' to get started. try: smile, say hi, morph <3, shape knot, mirror"],
        ]);
      }
      this.input.focus();
    }
  }

  async exec(line: string) {
    const trimmed = line.trim();
    this.print([['cmd', trimmed]]);
    if (!trimmed) return;
    this.history.push(trimmed);
    this.hIndex = this.history.length;
    const [name, ...args] = trimmed.split(/\s+/);
    const cmd = this.commands[name.toLowerCase()];
    if (!cmd) {
      this.print([['err', `command not found: ${name}. type 'help'`]]);
      this.api.expression('thinking');
      return;
    }
    const res = await cmd.run(args);
    this.print(res);
    const chars = res.map((l) => (typeof l === 'string' ? l : l[1])).join(' ').length;
    if (chars && name !== 'say') this.api.talk(Math.min(2.5, 0.4 + chars / 120));
  }

  private helpText(): Line[] {
    const visible = Object.entries(this.commands).filter(([, c]) => !c.hidden);
    return [
      ...visible.map(([n, c]) => `${n.padEnd(11, ' ')} ${c.help}`),
      ['dim', `shortcuts: ${EXPRESSION_NAMES.join(', ')} · plus a few hidden ones`],
    ];
  }

  private print(lines: Line[]) {
    for (const l of lines) {
      const div = document.createElement('div');
      if (typeof l === 'string') div.textContent = l;
      else {
        div.className = l[0];
        div.textContent = l[1];
      }
      this.out.appendChild(div);
    }
    this.out.scrollTop = this.out.scrollHeight;
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const v = this.input.value;
      this.input.value = '';
      void this.exec(v);
    } else if (e.key === 'ArrowUp') {
      this.hIndex = Math.max(0, this.hIndex - 1);
      this.input.value = this.history[this.hIndex] ?? '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      this.hIndex = Math.min(this.history.length, this.hIndex + 1);
      this.input.value = this.history[this.hIndex] ?? '';
      e.preventDefault();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = this.input.value.trim();
      const hits = Object.keys(this.commands).filter((c) => c.startsWith(v));
      if (hits.length === 1) this.input.value = hits[0] + ' ';
      else if (hits.length > 1) this.print([['dim', hits.join('  ')]]);
    } else if (e.key === 'Escape') {
      this.toggle(false);
    }
    e.stopPropagation();
  }
}
