import { describe, expect, test, vi } from "vitest"
import { AgentTeamPlugin } from "./index.js"

function pluginInput(client: any) {
  return {
    client,
    project: {},
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: vi.fn() },
    serverUrl: new URL("http://localhost:4096"),
    $: undefined,
  } as any
}

describe("AgentTeamPlugin startup", () => {
  test("does not call the OpenCode client while initializing", async () => {
    const client = {
      app: { log: vi.fn() },
      config: { get: vi.fn(() => new Promise(() => {})) },
    }

    const hooks = await AgentTeamPlugin(pluginInput(client))

    expect(client.config.get).not.toHaveBeenCalled()
    expect(hooks.tool).toBeUndefined()

    await hooks.config?.({ experimental: { agent_teams: true } } as any)
    expect(hooks.tool?.team_create).toBeDefined()

    await hooks.config?.({ experimental: { agent_teams: false } } as any)
    expect(hooks.tool).toBeUndefined()
  })
})
