const mockCreateTeam = vi.fn()

vi.mock("../team-service.js", () => ({
  createTeam: mockCreateTeam,
}))

import { teamCreateTool } from "./team-create.js"

function createMockClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({}),
    },
    tui: {
      showToast: vi.fn().mockResolvedValue({}),
    },
  }
}

const context = { sessionID: "lead-session-1" }

describe("teamCreateTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("creates a team and returns JSON with teamID, name, status", async () => {
    const teamResult = { teamID: "team-1", name: "test-team", status: "active" }
    mockCreateTeam.mockResolvedValue(teamResult)

    const toolDef = teamCreateTool(client)
    const result = await toolDef.execute(
      { name: "test-team", goal: "build great things" },
      context,
    )

    expect(mockCreateTeam).toHaveBeenCalledWith({
      name: "test-team",
      goal: "build great things",
      leadSessionID: "lead-session-1",
    })

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ teamID: "team-1", name: "test-team", status: "active" })
  })

  it("throws if team already exists for lead", async () => {
    mockCreateTeam.mockRejectedValue(new Error("Active team already exists for this lead session"))

    const toolDef = teamCreateTool(client)

    await expect(
      toolDef.execute({ name: "another", goal: "do something" }, context),
    ).rejects.toThrow("Active team already exists for this lead session")
  })

  it("has the correct tool description and args", () => {
    const toolDef = teamCreateTool(client)
    expect(toolDef.description).toBeTruthy()
    expect(toolDef.args).toHaveProperty("name")
    expect(toolDef.args).toHaveProperty("goal")
  })
})
