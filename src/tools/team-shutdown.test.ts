const mockGetActiveTeamForLead = vi.fn()
const mockShutdownTeam = vi.fn()
const mockGetTeamMembers = vi.fn()

vi.mock("../team-service.js", () => ({
  getActiveTeamForLead: mockGetActiveTeamForLead,
  shutdownTeam: mockShutdownTeam,
  getTeamMembers: mockGetTeamMembers,
}))

import { teamShutdownTool } from "./team-shutdown.js"

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

describe("teamShutdownTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team found", async () => {
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamShutdownTool(client)

    await expect(
      toolDef.execute({}, context),
    ).rejects.toThrow("No active team found for this session")
  })

  it("successfully shuts down team and deletes non-completed member sessions", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active",
    })
    mockShutdownTeam.mockResolvedValue(undefined)
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "session-1", name: "agent-1", status: "active" },
      { id: "m2", sessionID: "session-2", name: "agent-2", status: "blocked" },
      { id: "m3", sessionID: "session-3", name: "agent-3", status: "starting" },
    ])

    const toolDef = teamShutdownTool(client)
    const result = await toolDef.execute({}, context)

    expect(mockShutdownTeam).toHaveBeenCalledWith("team-1")
    expect(client.session.delete).toHaveBeenCalledTimes(3)
    expect(client.session.delete).toHaveBeenCalledWith({ path: { id: "session-1" } })
    expect(client.session.delete).toHaveBeenCalledWith({ path: { id: "session-2" } })
    expect(client.session.delete).toHaveBeenCalledWith({ path: { id: "session-3" } })
    expect(result).toBe("Team shut down. All active teammates have been cancelled.")
  })

  it("skips already completed or cancelled member sessions", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active",
    })
    mockShutdownTeam.mockResolvedValue(undefined)
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "session-1", name: "agent-1", status: "completed" },
      { id: "m2", sessionID: "session-2", name: "agent-2", status: "cancelled" },
      { id: "m3", sessionID: "session-3", name: "agent-3", status: "active" },
    ])

    const toolDef = teamShutdownTool(client)
    await toolDef.execute({}, context)

    expect(client.session.delete).toHaveBeenCalledTimes(1)
    expect(client.session.delete).toHaveBeenCalledWith({ path: { id: "session-3" } })
  })

  it("handles session delete errors gracefully", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active",
    })
    mockShutdownTeam.mockResolvedValue(undefined)
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "session-1", name: "agent-1", status: "active" },
    ])
    client.session.delete = vi.fn().mockRejectedValue(new Error("Session gone"))

    const toolDef = teamShutdownTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toBe("Team shut down. All active teammates have been cancelled.")
  })

  it("has empty args (no arguments required)", () => {
    const toolDef = teamShutdownTool(client)
    expect(toolDef.args).toEqual({})
  })
})
