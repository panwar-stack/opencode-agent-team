const mockGetTeamForMember = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockGetTeamTasks = vi.fn()

vi.mock("../team-service.js", () => ({
  getTeamForMember: mockGetTeamForMember,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  getTeamTasks: mockGetTeamTasks,
}))

import { teamTaskListTool } from "./team-task-list.js"

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

const context = { sessionID: "member-session-1" }

describe("teamTaskListTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamTaskListTool(client)

    await expect(
      toolDef.execute({}, context),
    ).rejects.toThrow("No active team membership found")
  })

  it('returns "No tasks in this team." when task list is empty', async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetTeamTasks.mockResolvedValue([])

    const toolDef = teamTaskListTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toBe("No tasks in this team.")
  })

  it("returns formatted task list with status icons", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetTeamTasks.mockResolvedValue([
      { id: "task-1", description: "Write tests", status: "pending", assignee: null, dependencyIDs: null },
      { id: "task-2", description: "Review code", status: "in_progress", assignee: null, dependencyIDs: null },
      { id: "task-3", description: "Deploy", status: "completed", assignee: null, dependencyIDs: null },
      { id: "task-4", description: "Cleanup", status: "cancelled", assignee: null, dependencyIDs: null },
    ])

    const toolDef = teamTaskListTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toContain("## Team Tasks")
    expect(result).toContain("⬜")
    expect(result).toContain("🔄")
    expect(result).toContain("✅")
    expect(result).toContain("❌")
    expect(result).toContain("Write tests")
    expect(result).toContain("Review code")
    expect(result).toContain("Deploy")
    expect(result).toContain("Cleanup")
    expect(result).toContain("[pending]")
    expect(result).toContain("[in_progress]")
    expect(result).toContain("[completed]")
    expect(result).toContain("[cancelled]")
  })

  it("shows assignee when present", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetTeamTasks.mockResolvedValue([
      { id: "task-1", description: "Write tests", status: "in_progress", assignee: "agent-1", dependencyIDs: null },
    ])

    const toolDef = teamTaskListTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toContain("(assigned: agent-1)")
  })

  it("shows dependency info when present", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetTeamTasks.mockResolvedValue([
      { id: "task-2", description: "Complex task", status: "pending", assignee: null, dependencyIDs: ["task-1", "task-3"] },
    ])

    const toolDef = teamTaskListTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toContain("depends on: task-1, task-3")
  })

  it("works for lead (via getActiveTeamForLead)", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({ id: "team-2", name: "lead-team", goal: "x", leadSessionID: "lead-2", status: "active" })
    mockGetTeamTasks.mockResolvedValue([
      { id: "task-1", description: "Lead's task", status: "pending", assignee: null, dependencyIDs: null },
    ])

    const toolDef = teamTaskListTool(client)
    const result = await toolDef.execute({}, { sessionID: "lead-2" })

    expect(result).toContain("Lead's task")
  })
})
