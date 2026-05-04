const mockGetTeamForMember = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockCreateTask = vi.fn()

vi.mock("../team-service.js", () => ({
  getTeamForMember: mockGetTeamForMember,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  createTask: mockCreateTask,
}))

import { teamTaskCreateTool } from "./team-task-create.js"

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

describe("teamTaskCreateTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamTaskCreateTool(client)

    await expect(
      toolDef.execute({ description: "Do something" }, context),
    ).rejects.toThrow("No active team membership found")
  })

  it("creates a task with description only", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockCreateTask.mockResolvedValue({ taskID: "task-1" })

    const toolDef = teamTaskCreateTool(client)
    const result = await toolDef.execute({ description: "Write tests" }, context)

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ taskID: "task-1" })
    expect(mockCreateTask).toHaveBeenCalledWith({
      teamID: "team-1",
      description: "Write tests",
      assignee: undefined,
      dependencyIDs: undefined,
    })
  })

  it("creates a task with optional assignee and dependency_ids", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockCreateTask.mockResolvedValue({ taskID: "task-2" })

    const toolDef = teamTaskCreateTool(client)
    const result = await toolDef.execute({
      description: "Complex task",
      assignee: "agent-1",
      dependency_ids: ["task-1"],
    }, context)

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ taskID: "task-2" })
    expect(mockCreateTask).toHaveBeenCalledWith({
      teamID: "team-1",
      description: "Complex task",
      assignee: "agent-1",
      dependencyIDs: ["task-1"],
    })
  })

  it("works for lead (via getActiveTeamForLead)", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({ id: "team-2", name: "lead-team", goal: "x", leadSessionID: "lead-2", status: "active" })
    mockCreateTask.mockResolvedValue({ taskID: "task-3" })

    const toolDef = teamTaskCreateTool(client)
    const result = await toolDef.execute(
      { description: "Lead's task" },
      { sessionID: "lead-2" },
    )

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ taskID: "task-3" })
    expect(mockCreateTask).toHaveBeenCalledWith({
      teamID: "team-2",
      description: "Lead's task",
      assignee: undefined,
      dependencyIDs: undefined,
    })
  })
})
