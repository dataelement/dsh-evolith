import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('ordinary plugin registers memory settings without a desktop workbench service', async () => {
  let definition
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const styles = []
  const removals = []
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
    document: {
      querySelector() { return null },
      createElement() { return { dataset: {}, remove() { removals.push('style') } } },
      head: { appendChild(style) { styles.push(style) } }
    }
  })
  const plugin = definition.factory(name => {
    assert.equal(name, 'react')
    return { createElement() {} }
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
  const sections = []
  const cleanups = []
  plugin.apply({
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    locale: { register() { return () => {} }, bind() { return () => '记忆' } },
    slots: {
      inject(name, fn) { assert.equal(name, 'settings.section'); fn() },
      register(options, component) { sections.push({ options, component }) }
    }
  })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].options.id, 'memory-bridge')
  assert.equal(sections[0].options.label(), '记忆')
  assert.equal(typeof sections[0].component, 'function')
  assert.equal(styles.length, 1)
  for (const cleanup of cleanups) cleanup()
  assert.deepEqual(removals, ['style'])
})
