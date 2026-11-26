const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('release tag selection binds both tag spellings to the checked-out commit', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-release-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'output');
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        ...args
      ],
      { cwd, encoding: 'utf8' }
    ).trim();
  function check(input = '', ref = '') {
    fs.writeFileSync(output, '');
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../.github/scripts/release-tag.cjs')], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        INPUT_TAG: input,
        GITHUB_REF_TYPE: ref ? 'tag' : 'branch',
        GITHUB_REF_NAME: ref
      }
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return fs.readFileSync(output, 'utf8');
  }
  git('init', '--quiet');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"1.2.0"}');
  git('add', 'package.json');
  git('commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const expected = (tag) => `tag_name=${tag}\nsha=${sha}\n`;
  assert.equal(check(), expected('v1.2.0'));
  assert.throws(() => check('v1.1.0'), /match the package version/);
  git('tag', '-a', '1.2.0', '-m', 'release');
  assert.equal(check(), expected('1.2.0'));
  assert.equal(check('1.2.0'), expected('1.2.0'));
  assert.throws(() => check('v1.2.0'), /Another tag/);
  git('commit', '--allow-empty', '-qm', 'later commit');
  assert.throws(() => check('1.2.0'), /different commit/);
  git('tag', '-d', '1.2.0');
  git('tag', 'v1.2.0', sha);
  git('checkout', '--detach', '--quiet', sha);
  assert.equal(check('', 'v1.2.0'), expected('v1.2.0'));
});
