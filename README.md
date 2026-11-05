# Compact Ready Cowork

An add-on for [Compact Ready](https://github.com/bablobanov/compact-ready): a separate plugin made of one small hooks module (a "mod") that runs inside Claude Code's plugin runtime. It gives `/compact-ready` the context figures, so the skill can say how full the context is and, where there is no `/compact`, print the word that compacts. It answers two words sent as whole messages, `context-left` and `context-compact`. It asks Claude to suggest `/compact-ready` when the context nears the auto-compaction point, and after a compaction it names the latest handoff, so Claude reads it before going on.

It is made for Claude Code and for Cowork, which runs on the Claude Code engine and has no `/compact` of its own; see Limitations for what has been tested so far. It needs Compact Ready 1.2.0 or newer: without the skill the two words still work, but nobody reads the figures the mod adds to the call. Compact Ready works in full without this add-on.

## Install

From this repository, in Claude Code:

```
/plugin marketplace add bablobanov/compact-ready
/plugin install compact-ready-cowork@bablobanov
```

Compact Ready itself is installed separately, from the Claude plugin directory or with `/plugin install compact-ready@bablobanov` from the same marketplace. Plugins from third-party marketplaces do not update on their own by default: to get a new version, run `/plugin marketplace update bablobanov`, then `/reload-plugins`.

## Context words

| Word | What it does | Where |
|---|---|---|
| `context-left` | shows the context fill as the engine measures it, the auto-compaction point and the last compaction the mod saw | Claude Code, Cowork |
| `context-compact` | compacts now, with the focus line of the latest `/compact-ready` in this session, or without a focus when there is none | Claude Code, Cowork |

Both work only as the whole message: a word inside a sentence does nothing. In Claude Code `context-left` also exists as the slash command `/context-left`. There is no `/context-compact`: the engine lets a plugin start a compaction only after one of Claude's replies, so the word is the way everywhere. In a chat on claude.ai the mod is not loaded, so the words do nothing there.

When the context reaches three quarters of the auto-compaction point the engine reports, the mod asks Claude to suggest `/compact-ready` once the current step is done; from nine tenths it repeats the suggestion once and keeps a note of the latest handoff beside every message. After a compaction it noticed, your next message carries a note naming the latest handoff, so Claude reads it before going on. The mod notices a compaction by the engine's own counter: a compaction that frees less than a fifth of the context (a short conversation under a large system prompt) can go unnoticed altogether, and a session you resume is not mistaken for one, with one exception: a session resumed within two minutes of a `context-compact` or `/compact` that never went through reads as that compaction.

## What the mod does

The hooks module reacts to five events of Claude Code's plugin runtime and runs one command. Nothing in it runs on a schedule of its own: every step below follows one of your messages or one of Claude's replies.

- **Session start and end.** It registers the slash command `/context-left` and keeps a small record of the session in the plugin's own storage; `/clear` removes that record.
- **Message submit.** It reads the text you sent, only to see whether it is one of the two words or a run of `/compact-ready` or `/compact`, and to pair your messages with Claude's replies. It adds the hidden notes described under Context words: the figures, the hints, the note after a compaction. It never changes your text and never submits a message.
- **Turn start and complete.** It pairs a reply with your message and remembers the final block `/compact-ready` printed in that turn. After the turn that answered your word `context-compact`, it runs Claude Code's own `/compact` command with the focus line of that block, or without a focus when there is no handoff yet. This is the only command the mod runs itself, and this is the only moment it runs it.
- **The slash command.** `/context-left` answers with the figures as text; it runs nothing.

## In Cowork

Cowork has no `/compact` command; this add-on gives you two words instead, sent as whole messages: `context-left` shows the context fill as the engine measures it; `context-compact` compacts with the focus of the latest handoff.

Run `/compact-ready` as usual; its last block names the handoff and tells you to send `context-compact`. The compaction starts after Claude's one-line reply and runs silently; the result shows with your next message.

Where mods are not loaded (an organisation's managed settings can keep them out), Compact Ready's block tells you how to continue in a new task; the words then do nothing.

## What it does not do

- It runs only inside Claude Code's plugin runtime: no network, no file reads, no file writes of its own, no tools for Claude, nothing drawn on screen. It never sends a message as you.
- It never compacts on its own: compaction starts only from your word `context-compact`.
- It does not change Compact Ready's skill; without this add-on the skill works as before.
- In a chat on claude.ai it is not loaded: plugins' hooks and mods do not run there.

## Privacy

The mod reads the text of your messages only to recognise the two words and the runs of `/compact-ready` and `/compact`, reads the final text of the turn that ran `/compact-ready` to find its block, and reads the context figures the engine already keeps. It writes hidden notes for Claude and no files. It keeps a small record per session in the plugin's own store, in the environment where the session runs, and sends nothing anywhere. See [PRIVACY.md](PRIVACY.md).

## Limitations

- Tested with Claude Code 2.1.318 through its plugin test kit and in headless sessions of the command line. A live run in the interactive terminal and in Cowork is still ahead; other versions were not tested.
- The auto-compaction point it shows is the one the engine reports; a managed environment can compact earlier.
- In Cowork the compaction runs silently: Claude tells you the result with your next message.
- Where mods are not loaded, for example under managed settings that keep them out, the words do nothing and Compact Ready works alone.
- It notices a compaction by the engine's own counter: a compaction that frees less than a fifth of the context can go unnoticed altogether; one that leaves the counter empty is noticed with the next message.

## How it was tested

Its tests run against the engine itself (`claude plugin test`): the two words sent as whole messages and inside a sentence; the hint bands at three quarters and nine tenths of the auto-compaction point, with and without auto-compaction; the focus taken only from the turn that ran `/compact-ready`, with decoy blocks, long lines and odd characters; a message typed while a long turn runs; a request that the engine never carried out; a session resumed after a compaction; the engine restarted right after the word, as Cowork does. Headless Claude Code sessions with both plugins loaded: the `/compact-ready` call prints the block with the word, `context-left` answers with the figures, a word inside a sentence does nothing, `context-compact` compacts with the handoff's focus, and the next message names the handoff.

## License

MIT. See [LICENSE](LICENSE).

Made by Ilya Balobanov · [bablobanov.com](https://bablobanov.com)
