'use strict';
/**
 * scripts/mirror.sh against a throwaway bare repository: what the public mirror
 * receives for a release. It exports the committed state (HEAD), so these tests
 * see the last commit, not the working tree. Skipped where there is nothing to
 * export from - in the mirror itself, and on a machine without git or sh.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const pkgDir = path.join(__dirname, '..');
const script = path.join(pkgDir, 'scripts', 'mirror.sh');

function git(args, cwd) {
    return spawnSync('git', args, { cwd: cwd || pkgDir, encoding: 'utf8' });
}

const prefix = git(['rev-parse', '--show-prefix']);
const inSource = prefix.status === 0 && prefix.stdout.trim() === 'tools/node-red-andon/';
const haveSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;
const opts = { skip: inSource && haveSh ? false : 'needs git, sh and the source repository' };

/** mirror runs the script against url; push=false is the rehearsal. */
function mirror(url, push) {
    const env = Object.assign({}, process.env, { MIRROR_URL: url, MIRROR_PUSH: push ? '1' : '0' });
    return spawnSync('sh', [script], { cwd: pkgDir, env, encoding: 'utf8' });
}

function bareRepo(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andon-mirror-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.equal(git(['init', '-q', '--bare', dir]).status, 0);
    return dir;
}

function committedVersion() {
    return JSON.parse(git(['show', 'HEAD:tools/node-red-andon/package.json']).stdout).version;
}

test('a release arrives as one commit on main, tagged, with the package at the root', opts, (t) => {
    const bare = bareRepo(t);
    const run = mirror(bare, true);
    assert.equal(run.status, 0, run.stderr);

    const version = committedVersion();
    assert.equal(git(['rev-list', '--count', 'main'], bare).stdout.trim(), '1');
    assert.equal(git(['rev-parse', 'v' + version], bare).stdout, git(['rev-parse', 'main'], bare).stdout);
    assert.equal(git(['log', '-1', '--format=%s', 'main'], bare).stdout.trim(), version);

    const files = git(['ls-tree', '-r', '--name-only', 'main'], bare).stdout.trim().split('\n');
    // The package sits at the root: package.json there is what npm publishes from.
    for (const f of ['package.json', 'README.md', 'lib/seal.js', 'nodes/andon-out.js', 'test/view.test.js']) {
        assert.ok(files.includes(f), f + ' is missing');
    }
    // Exactly the package directory as committed, and nothing from around it.
    const committed = git(['ls-tree', '-r', '--name-only', 'HEAD', '.']).stdout.trim().split('\n')
        .map((f) => f.replace(/^tools\/node-red-andon\//, ''));
    assert.deepEqual(files.slice().sort(), committed.sort());
    assert.ok(!files.some((f) => f.startsWith('node_modules/') || f.startsWith('tools/')));
});

test('a version is mirrored once', opts, (t) => {
    const bare = bareRepo(t);
    assert.equal(mirror(bare, true).status, 0);
    const again = mirror(bare, true);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already has v/);
    assert.equal(git(['rev-list', '--count', 'main'], bare).stdout.trim(), '1');
});

test('without MIRROR_PUSH nothing leaves', opts, (t) => {
    const bare = bareRepo(t);
    const run = mirror(bare, false);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /rehearsal/);
    assert.equal(git(['for-each-ref'], bare).stdout, '');
});
