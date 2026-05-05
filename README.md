# @panwar-stack/agent-team

OpenCode plugin that enables multi-agent team orchestration. Create teams of AI agents that collaborate on complex tasks with shared state, messaging, task tracking, and dependency management.

## Installation

```bash
npm install @panwar-stack/agent-team
```

Or add to your OpenCode config:

```json
{
  "plugins": ["@panwar-stack/agent-team"]
}
```

## What It Does

- **Team Management** — Create and shut down agent teams with a lead session and multiple teammate sessions
- **Parallel Execution** — Spawn multiple independent teammates that work concurrently
- **Messaging** — Teammates and leads can send messages, broadcasts, and status updates
- **Task Tracking** — Create, assign, claim, and update shared tasks with dependency chains
- **Plan Mode** — Teammates can operate in plan-only mode, submitting proposals for lead approval before implementation
- **Session Integration** — Hooks into OpenCode's system prompt, compaction, and session lifecycle events

## Available Tools

| Tool | Description |
|------|-------------|
| `team_create` | Create a new agent team for the current session |
| `team_spawn` | Spawn a new teammate session (supports dependencies) |
| `team_get_messages` | Read pending team mailbox messages |
| `team_send_message` | Send a message to a specific teammate or the lead |
| `team_broadcast` | Broadcast a message to all team members |
| `team_shutdown` | Shut down the team and cancel active teammates |
| `team_task_create` | Create a shared task with optional assignee and dependencies |
| `team_task_list` | List all shared tasks and their statuses |
| `team_task_claim` | Claim a pending task for the current teammate |
| `team_task_update` | Update a task's status or assignee |
| `team_plan_submit` | Submit a plan for lead approval (plan-mode teammates) |
| `team_plan_decide` | Approve or reject a teammate's submitted plan (lead only) |

## Usage

Once installed, the lead session automatically gets team orchestration injected into its system prompt. The lead can then create a team and spawn teammates:

```
// Lead creates a team
team_create("code-review", "Review the authentication module for security vulnerabilities")

// Spawn teammates in parallel
team_spawn("security-auditor", "explore", "Check auth.ts for SQL injection, XSS, and CSRF vulnerabilities")
team_spawn("dependency-checker", "explore", "Audit package.json for known vulnerable dependencies")
team_spawn("code-style", "explore", "Review auth.ts for code quality and best practices")

// Check for teammate updates
team_get_messages()

// When done, shut down the team
team_shutdown()
```

Teammates automatically receive their role prompt and team context. They proactively send progress, blocker, and completion messages to the lead.

## Configuration

No configuration required. State is stored in `~/.local/share/opencode/agent-team/teams.json`.

## Gaps vs. Built-in Agent Team Feature

The built-in agent team feature in OpenCode (from `747bf9f`) has deeper integration than is possible through the plugin API. Below is a status summary:

### Implemented in Plugin

These features match the built-in implementation:

| Feature | How It's Done |
|---------|---------------|
| Plan mode tool enforcement | `tool.execute.before` hook blocks `bash`/`write`/`edit`/`apply_patch` for plan-mode sessions |
| Result propagation | `session.status` completed/done events capture final message via `client.session.messages()` and relay to lead |
| Cascade auto-start | Unblocked dependent members are auto-started via `client.session.prompt()` |
| Permission inheritance | `deny` rules and `external_directory` passed from lead via `client.session.create()` options |
| Feature flag gating | Reads `client.config.get()` for `experimental.agent_teams` and conditionally registers tools |
| Session cancel handler | `session.status` event listener handles "cancelled" → updates member, notifies lead, triggers shutdown if all done |
| Toast notifications | `client.tui.showToast()` for team lifecycle events |
| Concurrent write safety | Mutex-based write lock with 100ms in-memory cache |
| Session compaction integration | `experimental.session.compacting` hook injects team context during compaction |
| Lead system prompt injection | `experimental.chat.system.transform` hook adds orchestration guidance |
| Teammate system prompt generation | Dynamic prompt includes name, team goal, role, plan mode, dependency results, and available tools |
| Message delivery with anti-polling guard | Delivers `<team-messages>` blocks via async `noReply: true` prompts; blocks repeated empty `team_get_messages` calls |
| Continuous decomposition guidance | Lead prompt includes: "Decompose continuously — as teammates return results, identify new sub-tasks and delegate those too" |

### Gaps Remaining — Plugin API Limitations

These require core changes to address:

| Gap | Details | Reason |
|-----|---------|--------|
| TUI team panel dialog | Full dialog with 3 tabs: Overview (members, pending permissions, shutdown), Tasks, Messages | TUI dialog API not exposed to plugins |
| TUI team sidebar | Sidebar with live member status dots, pending message counts, clickable member rows | Sidebar component API not exposed |
| TUI subagent footer label | Child sessions show "Team Member" label in footer | Footer customization not available |
| TUI keybinds for team nav | `<leader>v` toggle panel, `<leader>up` navigate to lead, `<leader>k` task list | Keybind registration not available |
| TUI sync store | Real-time `team_member_status` map handling `team.member.updated` events | Sync store not extensible from plugins |
| HTTP REST endpoints | `GET /team`, `GET /team/:teamID/messages`, `GET /team/:teamID/tasks`, `POST /team/shutdown` | Plugins cannot register server routes |
| Internal bus events | `team.created`, `team.closed`, `team.member.updated`, `team.message.received` events consumed by TUI and other subsystems | `Bus` system not exposed to plugins |
| SQLite persistence with migrations | Built-in uses SQLite + Drizzle ORM with 4 migrations; plugin uses JSON file | Plugins cannot register DB migrations |
| Loop-level sync message injection | Built-in delivers messages at the start of each agent loop iteration; plugin delivers via async `noReply: true` prompts (robust but asynchronous) | Plugin API only provides async session.prompt |
| Prompt guardrails against task takeover | Plugin prompt now includes "Delegate first, implement last" and "Trust teammate results — do not redo or duplicate their work"; built-in prompt is slightly more emphatic | System prompt customizations are limited |
| Detailed tool companion descriptions | Built-in tools have `.txt` companion files with richer descriptions and guardrails injected into the system prompt | Tool descriptions are inline only |

## Requirements

- Node.js >= 20
- OpenCode with plugin support (peer dependency: `@opencode-ai/plugin`)

## License

MIT
