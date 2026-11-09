# Compact Ready Context

Send `context-left` to see how full the context is, and `context-compact` to compact with the focus of your latest handoff, including in Cowork, where there is no `/compact`. This is an add-on for [Compact Ready](https://github.com/bablobanov/compact-ready): a separate plugin made of one small hooks module (a "mod") that runs inside Claude Code's plugin runtime. It gives `/compact-ready` the context figures, so the skill can say how full the context is and, where there is no `/compact`, print the word that compacts. It answers two words sent as whole messages, `context-left` and `context-compact`. It asks Claude to suggest `/compact-ready` when the context nears the auto-compaction point, and after a compaction it names the latest handoff, so Claude reads it before going on.

It is made for Claude Code and for Cowork, which uses the same agentic architecture as Claude Code and has no `/compact` of its own; see Limitations for what has been tested so far. It needs Compact Ready 1.2.0 or newer: without the skill the two words still work, but the figures the mod adds to the call go unused. Compact Ready works in full without this add-on.

## Install

The Claude plugin directory accepts mods only from Verified organizations, so the add-on is installed from the marketplace in the Compact Ready repository, `bablobanov/compact-ready`, in Claude Code and in Cowork alike.

**In Claude Code:**

```
/plugin marketplace add bablobanov/compact-ready
/plugin install compact-ready-context@bablobanov
```

Plugins from third-party marketplaces do not update on their own by default: to get a new version, run `/plugin marketplace update bablobanov`, then `/reload-plugins`.

**In Cowork, the Claude desktop app:** open **Customize**, then **Plugins**; choose **Add**, then **Add marketplace**, then **Add from a repository**; enter `bablobanov/compact-ready` (the field takes a GitHub owner/repo or a Git repository URL) and press **Sync**. Open **Discover**, select Compact Ready Context and press **Add**. The plugin is then listed under **Yours**, in "From marketplaces you added", marked "from compact-ready". No restart was needed in our test: the next new task answered `context-left` at once. Adding a public repository needs no GitHub account connected to the app; the app keeps the marketplace in sync on its own only after you grant the Claude GitHub App access and turn on **Sync automatically**, otherwise sync it by hand to get a new version. Add only this add-on from the marketplace: Compact Ready itself comes from the Claude plugin directory, and a second copy of it would give you two skills with one name.

**As a fallback,** add the plugin as a bundle under My Uploads on the same Plugins page: a zip of this repository with its `.claude-plugin/plugin.json`. A bundle added that way showed up in our test only after the desktop app was quit and opened again; a new task alone did not pick it up.

Compact Ready itself is installed separately, from the Claude plugin directory, or in Claude Code with `/plugin install compact-ready@bablobanov` from the same marketplace.

## Context words

| Word | What it does | Where |
|---|---|---|
| `context-left` | shows the context fill as the engine measures it, the auto-compaction point and the last compaction the mod saw | Claude Code, Cowork |
| `context-compact` | requests a compaction with the focus line of the latest `/compact-ready` in this session, or without a focus when there is none; the result shows before the reply to your next message | Claude Code, Cowork |

Both work only as the whole message: a word inside a sentence does nothing. In Claude Code `context-left` also exists as the slash command `/context-left`. There is no `/context-compact`: the engine lets a plugin start a compaction only after one of Claude's replies, so the word is the way everywhere. In a chat on claude.ai the mod is not loaded, so the words do nothing there.

When the context reaches three quarters of the auto-compaction point the engine reports, the mod asks Claude to suggest `/compact-ready` once the current step is done; from nine tenths it repeats the suggestion once and keeps a note of the latest handoff beside every message. After a compaction it noticed, your next message carries a note naming the latest handoff, so Claude reads it before going on. The mod notices a compaction by the engine's own counter. A compaction that frees a fifth of the context or less (a short conversation under a large system prompt) can go unnoticed altogether. A resumed session is not mistaken for a compaction, with one exception: if it is resumed within two minutes of a `context-compact` or `/compact` that never went through, and its first counter comes back empty or more than a fifth lower, it reads as that compaction.

## What the mod does

The hooks module reacts to five events of Claude Code's plugin runtime and runs one command. Nothing in it runs on a schedule of its own: every step below follows one of your messages or one of Claude's replies.

- **Session start and end.** It registers the slash command `/context-left` and keeps a small record of the session in the plugin's own storage; `/clear` removes that record.
- **Message submit.** It reads the text you sent, only to see whether it is one of the two words or a run of `/compact-ready` or `/compact`, and to pair your messages with Claude's replies. It adds the hidden notes described under Context words: the figures, the hints, the note after a compaction. It never changes your text and never submits a message.
- **Turn start and complete.** It pairs a reply with your message and remembers the final block `/compact-ready` printed in that turn. After the turn that answered your word `context-compact`, it runs Claude Code's own `/compact` command with the focus line of that block, or without a focus when there is no handoff yet. This is the only command the mod runs itself, and this is the only moment it runs it.
- **The slash command.** `/context-left` answers with the figures as text; it runs nothing.

## In Cowork

Cowork has no `/compact` command; this add-on gives you two words instead, sent as whole messages: `context-left` shows the context fill as the engine measures it; `context-compact` compacts with the focus of the latest handoff.

Run `/compact-ready` as usual, from the + menu under Plugins; its last block names the handoff and tells you, in your language, to send `context-compact`. Claude answers the word in one line; the compaction is requested with that reply, runs silently, and its result shows before the answer to your next message.

Where mods are not loaded (an organisation's managed settings can keep them out), Compact Ready's block tells you how to continue in a new task; the words then do nothing.

## What it does not do

- It runs only inside Claude Code's plugin runtime: no network, no file reads, no file writes of its own, no tools for Claude, nothing drawn on screen. It never sends a message as you.
- It never compacts on its own: compaction starts only from your word `context-compact`.
- It does not change Compact Ready's skill; without this add-on the skill works as before.
- In a chat on claude.ai it is not loaded: plugins' hooks and mods do not run there.

## Privacy

The mod reads the text of your messages only to recognise the two words and the runs of `/compact-ready` and `/compact`, reads the final text of the turn that ran `/compact-ready` to find its block, and reads the context figures the engine already keeps. It writes hidden notes for Claude and no files of its own. It keeps a small record per session in the plugin's own store, a file Claude Code holds in the environment where the session runs, and sends nothing over the network: inside the session, the notes go to Claude with your message and the focus line goes to the engine's compaction. See [PRIVACY.md](PRIVACY.md).

## Limitations

- Tested with Claude Code 2.1.318 through its plugin test kit, in headless and interactive sessions of the command line, and in Cowork (the Claude desktop app 4.23118.0 on Windows); other versions were not tested.
- The auto-compaction point it shows is the one the engine reports; a managed environment can compact earlier.
- In Cowork the compaction runs silently and takes effect before the reply to your next message; Claude's one-line answer to the word is the only sign of it.
- Where mods are not loaded, for example under managed settings that keep them out, the words do nothing and Compact Ready works alone.
- It notices a compaction by the engine's own counter, not by an event of the engine: a compaction that frees a fifth of the context or less can go unnoticed altogether; one that leaves the counter empty is noticed with the next message. In Cowork the counter is empty after the restart that follows `context-compact` whether or not the compaction freed anything, so in a short task, where the fixed part of the context (system prompt, tools, skills) is most of it, the note after the word can come while the figures afterwards are no lower than before. A request older than two minutes is dropped at a restart: close the task after the word and open it again later, and the compaction passes without a note; the focus it got still names the handoff.

## How it was tested

Its tests run against the engine itself (`claude plugin test`): the two words sent as whole messages and inside a sentence; the hint bands at three quarters and nine tenths of the auto-compaction point, with and without auto-compaction; the focus taken only from the turn that ran `/compact-ready`, with decoy blocks, long lines and odd characters; a message typed while a long turn runs; a request that the engine never carried out; a session resumed after a compaction; the engine restarted right after the word, as Cowork does. Headless Claude Code sessions with both plugins loaded: the `/compact-ready` call prints the block with the word, `context-left` answers with the figures, a word inside a sentence does nothing, `context-compact` compacts with the handoff's focus, and the next message names the handoff. An interactive terminal session with both plugins: the hint bands, the word with its focus, an automatic compaction with its note, a resumed session without one. A Cowork task with both plugins: `context-left` with the figures, the three-line block of `/compact-ready` and two calls in a row, `context-compact` and the next message naming the handoff, the word inside a sentence doing nothing, and the task closed and opened again after the word. A Cowork task with the add-on added from the marketplace `bablobanov/compact-ready` (the Claude desktop app 4.23118.0 on Windows): `context-left` answered in a new task without a restart, then `/compact-ready` printed the block, `context-compact` compacted, and the next message named the handoff.

## License

MIT. See [LICENSE](LICENSE).

Made by Ilya Balobanov · [bablobanov.com](https://bablobanov.com)
