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
    version: 'abc1234-dirty',
  })
})

test('About uses the same build identifier before and after the release tag is created', () => {
  const beforeTag = parseGitDescribe('0.1.15', 'v0.1.14-5-g5f52bb7')
  const afterTag = parseGitDescribe('0.1.15', 'v0.1.15-0-g5f52bb7')

  assert.deepEqual(aboutPanelOptions(beforeTag), {
    applicationName: 'Vibenote',
    applicationVersion: '0.1.15',
    version: '5f52bb7',
  })
  assert.deepEqual(aboutPanelOptions(beforeTag), aboutPanelOptions(afterTag))
})

test('About preserves the application version when Git metadata is unavailable', () => {
  assert.deepEqual(aboutPanelOptions(parseGitDescribe('0.1.15', 'unknown')), {
    applicationName: 'Vibenote',
    applicationVersion: '0.1.15',
    version: 'unknown',
  })
})
