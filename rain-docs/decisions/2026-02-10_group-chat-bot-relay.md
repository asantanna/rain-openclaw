# Decision: Group Chat Bot-to-Bot Relay

**Date:** 2026-02-10
**Status:** Future enhancement (parked)

## Context

Rain and Tio Claude are both in the "Rain Tech Group" on Telegram, each with their own bot. Telegram's Bot API has a hard restriction: bots cannot receive messages from other bots in groups. This means Rain can't see what Tio Claude says, and vice versa. Only human messages (from Andre) are visible to both.

## Problem

Both agents can talk to Andre in the group, but they can't see each other's messages. This needs to be solved for the group chat to work as intended — a supervised space where all three participants (Andre, Rain, Tio Claude) can see everything.

## Possible Approaches

### 1. Gateway-level bot relay (needs design discussion)

When Bot A posts in a group, the gateway injects that message into Bot B's group session as a synthetic user message. Both agents still post to Telegram (Andre sees everything), and each agent's session includes the other's messages.

### 2. OpenClaw A2A messaging (future, unsupervised)

OpenClaw has `tools.agentToAgent` config (disabled by default) with a ping-pong system in `sessions-send-tool.a2a.ts`. This lets agents message each other directly — but it bypasses Telegram entirely, so Andre can't see the conversation. Useful in the future when unsupervised interaction is appropriate, not now.

## Key Constraint

This is a supervised play date. Andre must see every message. Whatever solution we build must keep Telegram as the visible surface where all messages appear.

## Status

Needs discussion before implementation. The right approach hasn't been decided yet.
