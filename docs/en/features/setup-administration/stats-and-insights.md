---
title: "Stats & Insights"
sidebar:
  order: 4
---

TomoriBot tracks interaction metrics so you can inspect activity trends, model token usage,
popular personas, and tool calls, or render shareable infographic summary cards.

## Text Dashboards

Three commands open an interactive, tabbed dashboard:

- `/stats personal`: view your own usage statistics.
- `/stats persona`: view a specific persona's usage statistics on this server.
- `/stats server`: view server-wide statistics across all members and personas.

Each dashboard includes tabs for Overview, Personas, Models & Cost, Tools & Commands,
Expression, Favorite People, and Leaderboards.

Most subcommands let you specify a timeframe window (such as 7 days, 30 days, or all time).
Personal stats can be scoped either to the current server or across all servers where you use
TomoriBot.

Text dashboards are durable public messages controlled by the invoker. They remain interactive
until dismissed or deleted, and other members cannot manipulate your dashboard controls.

:::note
Token counts reflect provider-reported usage when available (a character-based estimate is used
only for providers that omit token metrics). Cost figures price those tokens at list rates from
the model catalog, so they may differ from your actual bill due to prompt caching, provider
discounts, or free-tier quotas.
:::

## Shareable Infographic Cards

Run `/stats generate` to render a polished summary image card you can share directly in chat:

- **Personal Wrapped**: summarizes your personal activity and favorite personas.
- **Persona Affinity**: highlights a specific persona's stats and top conversational partners on
  this server.
- **Server Leaderboard**: displays server-wide activity and member standings.

Users with their privacy level set to `Full` in `/personal config` cannot generate personal stats
cards.

For details on how cards are composed and rendered, see the
[stats infographic subsystem](/architecture/subsystems/stats-infographic/).
