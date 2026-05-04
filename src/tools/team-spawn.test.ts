const mockGetActiveTeamForLead = vi.fn()
const mockAddMember = vi.fn()
const mockIsMemberBlocked = vi.fn()
const mockGetTeamMembers = vi.fn()
const mockUpdateMemberStatus = vi.fn()
const mockGetTeamState = vi.fn()

vi.mock("../team-service.js", () => ({
  getActiveTeamForLead: mockGetActiveTeamForLead,
  addMember: mockAddMember,
  isMemberBlocked: mockIsMemberBlocked,
  getTeamMembers: mockGetTeamMembers,
  updateMemberStatus: mockUpdateMemberStatus,
}))

vi.mock("../db.js", () => ({
  getTeamState: mockGetTeamState,
}))

vi.mock("../system-prompt.js", () => ({
  generateTeammateSystemPrompt: vi.fn().mockReturnValue("mock system prompt"),
}))

import { teamSpawnTool } from "./team-spawn.js"

function createMockClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ data: { id: "child-session-1" } }),
      get: vi.fn().mockResolvedValue({ data: { permission: { external_directory: ["/tmp"] } } }),
      delete: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({}),
    },
    tui: {
      showToast: vi.fn().mockResolvedValue({}),
    },
  }
}

const context = { sessionID: "lead-session-1" }

describe("teamSpawnTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team found", async () => {
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamSpawnTool(client)

    await expect(
      toolDef.execute(
        { name: "test-agent", agent_type: "general", role_prompt: "Do work" },
        context,
      ),
    ).rejects.toThrow("No active team found")
  })

  it("success path — creates child session, adds member, sends prompts, returns JSON", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    mockGetActiveTeamForLead.mockResolvedValue(team)
    mockGetTeamMembers.mockResolvedValue([])
    mockAddMember.mockResolvedValue({ memberID: "member-1", sessionID: "child-session-1", dependencyIDs: null })
    mockIsMemberBlocked.mockResolvedValue(false)
    mockGetTeamState.mockResolvedValue({ members: [{ id: "member-1", name: "test-agent", sessionID: "child-session-1", dependencyIDs: null, status: "starting", planMode: false }] })

    const toolDef = teamSpawnTool(client)
    const result = await toolDef.execute(
      { name: "test-agent", agent_type: "general", role_prompt: "Do work", plan_mode: false },
      context,
    )

    expect(client.session.create).toHaveBeenCalled()
    expect(mockAddMember).toHaveBeenCalled()
    expect(client.session.prompt).toHaveBeenCalledTimes(2)

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({
      memberID: "member-1",
      sessionID: "child-session-1",
      dependencyIDs: null,
      status: "active",
      message: "Teammate spawned successfully",
    })
  })

  it("blocked path — returns blocked status when dependencies not satisfied", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    mockGetActiveTeamForLead.mockResolvedValue(team)
    mockGetTeamMembers.mockResolvedValue([])
    mockAddMember.mockResolvedValue({ memberID: "member-2", sessionID: "child-session-2", dependencyIDs: ["dep-1"] })
    mockIsMemberBlocked.mockResolvedValue(true)
    mockGetTeamState.mockResolvedValue({ members: [{ id: "member-2", name: "test-agent", sessionID: "child-session-2", dependencyIDs: ["dep-1"], status: "starting", planMode: false }] })

    const toolDef = teamSpawnTool(client)
    const result = await toolDef.execute(
      { name: "test-agent", agent_type: "general", role_prompt: "Do work", depends_on: ["dep-1"] },
      context,
    )

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({
      memberID: "member-2",
      sessionID: "child-session-1",
      dependencyIDs: ["dep-1"],
      status: "blocked",
      message: "Teammate blocked — waiting for dependencies to complete",
    })
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  it("plan mode — adds deny rules for bash/write/edit/apply_patch", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    mockGetActiveTeamForLead.mockResolvedValue(team)
    mockGetTeamMembers.mockResolvedValue([])
    mockAddMember.mockResolvedValue({ memberID: "member-3", sessionID: "child-session-3", dependencyIDs: null })
    mockIsMemberBlocked.mockResolvedValue(false)
    mockGetTeamState.mockResolvedValue({ members: [{ id: "member-3", name: "plan-agent", sessionID: "child-session-3", dependencyIDs: null, status: "starting", planMode: true }] })

    const toolDef = teamSpawnTool(client)
    await toolDef.execute(
      { name: "plan-agent", agent_type: "general", role_prompt: "Plan stuff", plan_mode: true },
      context,
    )

    const createCallArgs = (client.session.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createCallArgs.body.permission.deny).toEqual(
      expect.arrayContaining([
        { permission: "bash", action: "deny" },
        { permission: "write", action: "deny" },
        { permission: "edit", action: "deny" },
        { permission: "apply_patch", action: "deny" },
      ]),
    )
  })

  it("rejects if child session create returns no ID", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    client.session.create = vi.fn().mockResolvedValue({ data: {} })
    mockGetActiveTeamForLead.mockResolvedValue(team)

    const toolDef = teamSpawnTool(client)

    await expect(
      toolDef.execute({ name: "bad", agent_type: "general", role_prompt: "x" }, context),
    ).rejects.toThrow("Failed to get child session ID")
  })

  it("inherits permission from lead session", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    mockGetActiveTeamForLead.mockResolvedValue(team)
    mockGetTeamMembers.mockResolvedValue([])
    mockAddMember.mockResolvedValue({ memberID: "member-4", sessionID: "child-session-4", dependencyIDs: null })
    mockIsMemberBlocked.mockResolvedValue(false)
    mockGetTeamState.mockResolvedValue({ members: [{ id: "member-4", name: "perm-agent", sessionID: "child-session-4", dependencyIDs: null, status: "starting", planMode: false }] })

    const toolDef = teamSpawnTool(client)
    await toolDef.execute(
      { name: "perm-agent", agent_type: "general", role_prompt: "Do work" },
      context,
    )

    const createCallArgs = (client.session.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createCallArgs.body.permission).toEqual({ external_directory: ["/tmp"] })
  })

  it("uses wait_for as alias for depends_on", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    mockGetActiveTeamForLead.mockResolvedValue(team)
    mockGetTeamMembers.mockResolvedValue([])
    mockAddMember.mockResolvedValue({ memberID: "member-5", sessionID: "child-session-5", dependencyIDs: ["dep-wf"] })
    mockIsMemberBlocked.mockResolvedValue(false)
    mockGetTeamState.mockResolvedValue({ members: [{ id: "member-5", name: "wf-agent", sessionID: "child-session-5", dependencyIDs: ["dep-wf"], status: "starting", planMode: false }] })

    const toolDef = teamSpawnTool(client)
    await toolDef.execute(
      { name: "wf-agent", agent_type: "general", role_prompt: "Do work", wait_for: ["dep-wf"] },
      context,
    )

    const addMemberCallArgs = mockAddMember.mock.calls[0][0]
    expect(addMemberCallArgs.dependencyIDs).toEqual(["dep-wf"])
  })

  it("finds dependency results from completed members", async () => {
    const team = { id: "team-1", name: "test-team", goal: "goals", leadSessionID: "lead-session-1", status: "active" }
    mockGetActiveTeamForLead.mockResolvedValue(team)
    mockGetTeamMembers.mockResolvedValue([
      { id: "dep-member-1", sessionID: "dep-session-1", name: "dep-agent", status: "completed", result: "Dep work done!" },
    ])
    mockAddMember.mockResolvedValue({ memberID: "member-6", sessionID: "child-session-6", dependencyIDs: ["dep-member-1"] })
    mockIsMemberBlocked.mockResolvedValue(false)
    mockGetTeamState.mockResolvedValue({ members: [{ id: "member-6", name: "result-agent", sessionID: "child-session-6", dependencyIDs: ["dep-member-1"], status: "starting", planMode: false }] })

    const toolDef = teamSpawnTool(client)
    const result = await toolDef.execute(
      { name: "result-agent", agent_type: "general", role_prompt: "Continue work", depends_on: ["dep-member-1"] },
      context,
    )

    const parsed = JSON.parse(result)
    expect(parsed.status).toBe("active")
  })
})
