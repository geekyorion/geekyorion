import { AWARDS, CERTS, COMMITS, LINKS, PROFILE, PROJECTS, STACK, yearsOfExperience } from '../content';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const $ = (id: string) => document.getElementById(id)!;

function whoamiCode() {
  const s = (v: string) => `<span class="tk-s">'${esc(v)}'</span>`;
  const arr = (a: string[]) => `[${a.map(s).join(', ')}]`;
  const years = yearsOfExperience();
  return [
    `<span class="tk-k">const</span> <span class="tk-f">shashank</span> = {`,
    `  <span class="tk-p">handle</span>:   ${s('@' + PROFILE.handle)},`,
    `  <span class="tk-p">role</span>:     ${s(PROFILE.role)},`,
    `  <span class="tk-p">based</span>:    ${s(PROFILE.location)},`,
    `  <span class="tk-p">shipping</span>: <span class="tk-n">${years}</span>, <span class="tk-c">// years, since ${PROFILE.since}</span>`,
    `  <span class="tk-p">focus</span>:    ${arr(PROFILE.focus.slice(0, 3))},`,
    `  <span class="tk-p">loves</span>:    ${arr(['micro-frontends', 'shaders'])},`,
    `  <span class="tk-p">offline</span>:  ${arr(['chess', 'sudoku', 'lo-fi'])},`,
    `};`,
    ``,
    `<span class="tk-f">shashank</span>.<span class="tk-f">hire</span>(); <span class="tk-c">// → scroll to contact</span>`,
  ].join('\n');
}

function gitlog() {
  return COMMITS.map((c) => `
    <li>
      <div class="commit-head">
        <span class="hash">${c.hash}</span>
        ${c.branch ? `<span class="ref">(${esc(c.branch)})</span>` : ''}
        <span><span class="commit-type">${c.type}</span>(${esc(c.scope)})</span>
        ${c.award ? `<span class="award">★ ${esc(c.award)}</span>` : ''}
      </div>
      <div class="commit-title">${esc(c.title)}</div>
      <ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="tags">${c.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    </li>`).join('');
}

function projects() {
  return PROJECTS.map((p) => `
    <article class="proj${p.featured ? ' featured' : ''}">
      <span class="kind">${esc(p.kind)}</span>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.desc)}</p>
      <div class="tags">${p.tech.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="links">${p.links.length
        ? p.links.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')
        : '<span class="private">// private repo</span>'}</div>
    </article>`).join('');
}

function stack() {
  return STACK.map((g) => `
    <div class="stack-row">
      <span class="g">${esc(g.group)}</span>
      <span class="bar" aria-label="${g.level} out of 5">${'█'.repeat(g.level)}${'░'.repeat(5 - g.level)}</span>
      <span class="items">${g.items.map(esc).join(' · ')}</span>
    </div>`).join('');
}

function npxCard() {
  const row = (label: string, value: string, href?: string) =>
    `<span class="lbl">${label}</span>${href ? `<a class="v" href="${href}" target="_blank" rel="noopener">${esc(value)}</a>` : `<span class="v">${esc(value)}</span>`}`;
  return [
    `<strong>${esc(PROFILE.name)}</strong> <span class="dim">/ ${esc(PROFILE.handle)}</span>`,
    `<span class="dim">${esc(PROFILE.role)} · ${esc(PROFILE.location)}</span>`,
    '',
    row('email', PROFILE.email, `mailto:${PROFILE.email}`),
    ...LINKS.map((l) => row(l.label.toLowerCase().split(' ')[0], l.href.replace(/^https?:\/\/(www\.)?/, ''), l.href)),
    '',
    `<span class="dim">$</span> npx geekyorion <span class="dim"># the real card, in your terminal</span>`,
  ].join('\n');
}

export function renderSections() {
  $('whoami-code').innerHTML = whoamiCode();
  $('bio').textContent = PROFILE.bio;
  $('gitlog').innerHTML = gitlog();
  $('project-list').innerHTML = projects();
  $('stack-list').innerHTML = stack();
  $('awards').innerHTML = AWARDS.map((a) => `<li>${esc(a)}</li>`).join('');
  $('certs').innerHTML = CERTS.map((a) => `<li>${esc(a)}</li>`).join('');
  $('npx-card').innerHTML = npxCard();
  $('year').textContent = String(new Date().getFullYear());
}

/** Typewriter cycling through roles in the hero. */
export function typewriter(el: HTMLElement, words: string[], reduced: boolean) {
  if (reduced) return;
  let w = 0, i = words[0].length, dir = -1, hold = 40;
  setInterval(() => {
    if (hold-- > 0) return;
    i += dir;
    if (i <= 0) { dir = 1; w = (w + 1) % words.length; }
    if (i >= words[w].length) { dir = -1; hold = 45; }
    el.textContent = words[w].slice(0, Math.max(0, i));
  }, 45);
}
