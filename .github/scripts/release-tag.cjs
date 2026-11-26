const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');
const process = require('node:process');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const names = [`v${version}`, version];
const requested =
  process.env.INPUT_TAG?.trim() || (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME);
if (requested && !names.includes(requested)) throw new Error('Tag must match the package version');
const tags = new Set(git('tag', '--list').split('\n'));
const existing = names.filter((name) => tags.has(name));
const tag = requested || existing[0] || names[0];
if (existing.some((name) => name !== tag)) throw new Error('Another tag already exists for this version');
git('check-ref-format', `refs/tags/${tag}`);
const sha = git('rev-parse', 'HEAD');
if (tags.has(tag) && git('rev-parse', `refs/tags/${tag}^{commit}`) !== sha) {
  throw new Error('Release tag points to a different commit');
}
appendFileSync(process.env.GITHUB_OUTPUT, `tag_name=${tag}\nsha=${sha}\n`);
