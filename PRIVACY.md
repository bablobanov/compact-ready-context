# Privacy Policy

Last updated: 2026-11-05

Compact Ready Cowork is an add-on plugin for Compact Ready made of one small hooks module (a "mod") that runs inside Claude Code's plugin runtime, in the environment of your session: on your machine in the terminal, in the session's container in Cowork. In a chat on claude.ai it does not load. It has no other code: no scripts, MCP servers or network requests, and the author runs no server for it.

## What it reads

The text of your messages, only to check whether a message is exactly the word `context-left` or `context-compact`, or a run of `/compact-ready` or `/compact`, and to tell which reply belongs to which message; the final text of Claude's reply in the turn that ran `/compact-ready`, only to find the block that command printed; and the context figures the engine already keeps (tokens used, window, auto-compaction point). It reads no files and no other sessions.

## What it writes

Hidden notes beside your messages that only Claude reads: the figures, a suggestion to run `/compact-ready` when the context gets close to the auto-compaction point, and, after a compaction, the path of the latest handoff, as a quoted string marked as data. It writes no files of its own; what it keeps is in the plugin store described below, which Claude Code holds as a file.

## What it keeps

In the plugin's own store, a JSON file under the Claude Code configuration directory of the session's environment: per session, the handoff path and the focus line `/compact-ready` printed, cut to 2,000 characters (it describes your task, so it can contain file names, decisions and error messages, like the handoff file itself), when it was printed, the last context figures, which hints were given, the first 80 characters of your recent messages while the mod waits for their replies, pending compaction requests, and the last error of the mod. The last 20 sessions are kept; a session you clear with `/clear` is removed. Delete the plugin to remove the store, or delete the file. In Cowork the store lives in the session's container under Anthropic's environment, not on your disk.

## What it sends

Nothing over the network: it has no network code, and the author receives nothing. Inside the session it hands text to Claude Code: the hidden notes, with the handoff path as a quoted string, go to the model with your message; the focus line goes to the engine's own compaction, the same place a pasted `/compact` line goes, and from there to the model with the rest of the conversation, under Claude Code's own terms.

## What the author collects

Nothing automatically: there is no telemetry, analytics or account. If you open a GitHub issue or send an email, the author receives what you choose to send, and GitHub or your email provider handles it under their own policies.

## How long data is kept

The store keeps the last 20 sessions until the plugin or the file is deleted; `/clear` removes the current session's record. The author keeps nothing.

## Contact

Open an issue at https://github.com/bablobanov/compact-ready-cowork/issues or write to info@bablobanov.com.
