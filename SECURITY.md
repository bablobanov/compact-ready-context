# Security Policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do not report security problems in public issues.

- Preferred: open a private report on GitHub (Security tab → Report a vulnerability): https://github.com/bablobanov/compact-ready-context/security/advisories/new
- Or email info@bablobanov.com with "compact-ready-context security" in the subject.

Please include what you found, how to reproduce it, the plugin version and your Claude Code version.

## What to expect

I confirm receipt within two working days, investigate, and keep you updated. A confirmed problem is fixed in a new release. I credit reporters in the changelog unless they ask not to be named.

## Scope

Compact Ready Context is one small hooks module. In scope:

- code in the module that could read or write files, reach the network, act as the user, or alter messages beyond the hidden notes described in PRIVACY.md
- problems in the plugin manifest

Out of scope:

- Claude Code itself: report to Anthropic under its Responsible Disclosure Policy (https://www.anthropic.com/responsible-disclosure-policy)
- the Compact Ready skill: see its own repository
