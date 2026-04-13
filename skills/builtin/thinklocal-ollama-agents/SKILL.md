# Thinklocal Ollama Agents

Use this skill when a user asks whether local Ollama models can participate in
the thinklocal mesh, wants to launch a local model-backed agent, or wants to
delegate work to an Ollama-backed peer/persona.

## Core idea

Treat Ollama as a local capability provider, not as a mesh primitive.

The mesh advertises capabilities; Ollama provides model execution behind those
capabilities. An Ollama-backed agent can therefore be represented as a skill
when it makes one or more model-backed abilities available to other peers.

## Mesh status first

Before launching or delegating, check the mesh:

1. Run `mesh_status` to see whether the local daemon is reachable.
2. Run `discover_peers` to see current peers.
3. Run `query_capabilities` with `category` or `skill_id` when looking for a
   specific model-backed ability.

If the mesh is down, report that clearly before working on Ollama.

## Model inventory

Use `ollama list` to inspect local models.

Selection rules:

- Prefer local models from `ollama list`.
- Do not select Kimi/K2 models; treat them as cloud-backed for this environment.
- Unless a model manifest says otherwise, assume `context_window=128k` and
  `max_output_tokens=4k`.
- If multiple usable models fit, choose the smallest capable model for routine
  status or routing work, and a stronger coding/reasoning model for code changes.

## Launching an agent persona

Use this pattern:

```bash
ollama launch <claude|codex|droid|openrouter|openclaw> --model <model-from-ollama-list>
```

The launched persona exposes model-backed agent behavior through Ollama. Use the
OpenAI-compatible endpoint for agent clients:

```text
https://10.10.25.103:11434/v1
```

Use the native Ollama API for model/server checks:

```text
https://localhost:11434/api
```

If the local Ollama server is configured without TLS, use the configured `http`
endpoint instead of forcing `https`.

## Delegation pattern

When a user asks to use Ollama through the mesh:

1. Confirm the mesh is reachable.
2. List local models with `ollama list`.
3. Choose a non-Kimi model.
4. Launch the requested persona if it is not already running.
5. Announce or use the capability as one of:
   - `ollama.models`
   - `ollama.agent.launch`
   - `ollama.agent.endpoint`
   - `ollama.agent.delegate`
6. Delegate via `execute_remote_skill` only after the relevant capability is
   visible and active in the mesh.

## Operational guardrails

- Keep credentials out of skill prompts and mesh announcements.
- Do not advertise cloud-backed models as local mesh capabilities.
- Do not change global Ollama configuration just to satisfy one task.
- Prefer explicit endpoints from local config over hard-coded defaults.
- If model launch fails, report the exact command and error, then fall back to
  another local model only when the user did not request a specific model.

## Answering "is this a skill?"

Yes. In thinklocal terms, the skill is not "the model" itself. The skill is the
capability wrapper that lets peers discover, route to, and use local
Ollama-backed agent execution.
