import assert from 'node:assert/strict'
import test from 'node:test'

import { aboutPanelOptions, parseGitDescribe } from '../../electron/buildInfo.js'

test('build version distinguishes a tag, later commits, and dirty source', () => {
  assert.deepEqual(parseGitDescribe('0.1.12', 'v0.1.12-0-g65bf66a'), {
    appVersion: '0.1.12',
    gitDescribe: 'v0.1.12-0-g65bf66a',
    tag: 'v0.1.12',
    commitDistance: 0,
    commit: '65bf66a',
    dirty: false,
  })

  assert.deepEqual(parseGitDescribe('0.1.12', 'v0.1.12-3-gabc1234-dirty'), {
    appVersion: '0.1.12',
    gitDescribe: 'v0.1.12-3-gabc1234-dirty',
    tag: 'v0.1.12',
    commitDistance: 3,
    commit: 'abc1234',
    dirty: true,
  })
})

test('build version remains useful when no tag is available', () => {
  assert.deepEqual(parseGitDescribe('0.1.12', 'abc1234-dirty'), {
    appVersion: '0.1.12',
    gitDescribe: 'abc1234-dirty',
    tag: null,
    commitDistance: null,
    commit: 'abc1234',
    dirty: true,
  })
})

test('About Vibenote keeps the release version and shows the Git build', () => {
  const buildInfo = parseGitDescribe('0.1.12', 'v0.1.12-3-gabc1234-dirty')

  assert.deepEqual(aboutPanelOptions(buildInfo), {
    applicationName: 'Vibenote',
    applicationVersion: '0.1.12',
    version: 'v0.1.12-3-gabc1234-dirty',
  })
})
