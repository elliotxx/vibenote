import assert from 'node:assert/strict'
import test from 'node:test'
import { selectLocalIdentity } from '../../scripts/local-mac.mjs'

const a = 'A'.repeat(40)
const b = 'B'.repeat(40)
const dev = hash => `1) ${hash} "Apple Development: Example (TESTTEAM01)"`

test('local signing rejects missing, distribution, and ambiguous certificates', () => {
  for (const value of ['', `1) ${a} "Apple Distribution: Example"`, `${dev(a)}\n${dev(b)}`]) {
    assert.throws(() => selectLocalIdentity(value), /exactly one valid Apple Development/)
  }
})

test('stable certificate selection deduplicates identities and accepts exact SHA-1 only', () => {
  assert.equal(selectLocalIdentity(`${dev(a)}\n${dev(a)}`).hash, a)
  assert.equal(selectLocalIdentity(`${dev(a)}\n${dev(b)}`, b.toLowerCase()).hash, b)
  assert.throws(() => selectLocalIdentity(dev(a), a.slice(0, 10)), /exactly one/)
})
