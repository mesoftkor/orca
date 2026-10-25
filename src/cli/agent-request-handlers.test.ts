import { describe, expect, it, vi } from 'vitest'
import { parseArgs, specPaths, validateCommandAndFlags } from './args'
import { AGENT_REQUEST_COMMAND_SPECS } from './specs/agent-requests'
import { AGENT_REQUEST_HANDLERS } from './handlers/agent-requests'
import type { HandlerContext } from './dispatch'
import type { RuntimeClient } from './runtime-client'
import {
  REQUEST_SESSION,
  REQUEST_WORKSPACE,
  requestFixtureClient
} from './agent-request-test-fixtures'

function context(entries: [string, string | boolean][]) {
  const { client, call } = requestFixtureClient()
  // SAFETY: these handlers consume only call; the test supplies that exact checked fake interface.
  const runtimeClient = client as RuntimeClient
  const value: HandlerContext = {
    flags: new Map(entries),
    client: runtimeClient,
    cwd: '/unused',
    json: true
  }
  return { value, call }
}

async function handler(key: string, input: HandlerContext) {
  const selected = AGENT_REQUEST_HANDLERS[key]
  if (!selected) {
    throw new Error('Missing test handler')
  }
  await selected(input)
}

describe('public scoped native-request commands', () => {
  it('parses the three-level command and a valued same-operation retry', () => {
    const argv = [
      'agent',
      'requests',
      'answer',
      '--worktree',
      `id:${REQUEST_WORKSPACE}`,
      '--session',
      REQUEST_SESSION,
      '--request-file',
      'answer.json',
      '--retry',
      '33333333-3333-4333-8333-333333333333',
      '--json'
    ]
    const parsed = parseArgs(
      argv,
      AGENT_REQUEST_COMMAND_SPECS.flatMap(specPaths),
      AGENT_REQUEST_COMMAND_SPECS
    )
    validateCommandAndFlags(AGENT_REQUEST_COMMAND_SPECS, parsed)
    expect(parsed.commandPath).toEqual(['agent', 'requests', 'answer'])
    expect(parsed.flags.get('retry')).toBe('33333333-3333-4333-8333-333333333333')
  })

  it.each(['--yes', '--all', '--force', '--text', '--approve-all'])(
    'does not offer a blanket or inline-body flag: %s',
    (flag) => {
      const parsed = parseArgs(
        ['agent', 'requests', 'answer', flag],
        AGENT_REQUEST_COMMAND_SPECS.flatMap(specPaths),
        AGENT_REQUEST_COMMAND_SPECS
      )
      expect(() => validateCommandAndFlags(AGENT_REQUEST_COMMAND_SPECS, parsed)).toThrow()
    }
  )

  it.each(['active', 'current', 'all', '*'])(
    'refuses ambient workspace %s before RPC',
    async (worktree) => {
      const { value, call } = context([
        ['worktree', worktree],
        ['session', REQUEST_SESSION]
      ])
      await expect(handler('agent requests list', value)).rejects.toMatchObject({
        code: 'invalid_argument'
      })
      expect(call).not.toHaveBeenCalled()
    }
  )

  it('requires a session and get item without touching the runtime', async () => {
    const missingSession = context([['worktree', `id:${REQUEST_WORKSPACE}`]])
    await expect(handler('agent requests list', missingSession.value)).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(missingSession.call).not.toHaveBeenCalled()
    const missingItem = context([
      ['worktree', `id:${REQUEST_WORKSPACE}`],
      ['session', REQUEST_SESSION]
    ])
    await expect(handler('agent requests get', missingItem.value)).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(missingItem.call).not.toHaveBeenCalled()
  })

  it('prints the complete scoped result with host identity, rather than an approval command', async () => {
    const { value } = context([
      ['worktree', `id:${REQUEST_WORKSPACE}`],
      ['session', REQUEST_SESSION]
    ])
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await handler('agent requests list', value)
      const response = JSON.parse(String(output.mock.calls[0]?.[0]))
      expect(response.result).toMatchObject({
        workspaceId: REQUEST_WORKSPACE,
        sessionId: REQUEST_SESSION,
        resumed: 'unverified'
      })
      expect(response.result.requests).toHaveLength(1)
    } finally {
      output.mockRestore()
    }
  })
})
