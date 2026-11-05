# Changelog

## 1.0.0 (unreleased)

- First release: an add-on for Compact Ready with one hooks module. Two words, sent as whole messages: `context-left` shows the context fill as the engine measures it; `context-compact` compacts with the focus line of the latest `/compact-ready`. In Claude Code `context-left` also exists as the slash command `/context-left`.
- Adds the context figures to the `/compact-ready` call, so the skill can print the block with the word to send where there is no `/compact`.
- Suggests running `/compact-ready` when the context reaches three quarters of the auto-compaction point, again at nine tenths, and names the latest handoff after a compaction it noticed, automatic ones included.
- The focus for `context-compact` is taken only from the final block of the turn that ran `/compact-ready`, cut to 2,000 characters with its handoff path and fixed phrases kept, control and separator characters replaced by spaces.
- Tests run with the plugin test kit of Claude Code 2.1.318.
