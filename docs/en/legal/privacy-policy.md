---
title: Privacy Policy
description: How the official hosted TomoriBot instance collects, uses, and deletes your data.
aiGenerated: false
---

Last updated: 2026-10-22

This policy covers the official hosted TomoriBot on Discord, including personal use, Server use, and sponsored requests. If you self-host TomoriBot, you control your own data; this policy does not govern your copy.

## Privacy at a glance

- TomoriBot reads recent messages to answer and sends relevant context to the selected AI provider. We do not save a copy of your chat history, but optional short-term memory saves summaries.
- We keep the settings, memories, and files you or your Server choose to save. Some Server memories may describe members who did not provide them.
- Paid memberships add account links, sponsorships, and usage records so we can provide benefits and track the shared allowance. We do not collect your Patreon password or card details.
- You can review or delete most saved data through commands. Subscription records require a separate support request. Deleting bot data does not cancel Patreon billing.

## 1) Who this policy covers

This includes members whose messages TomoriBot reads even if they never use a command. Server managers must tell members about the bot and this policy. Read the current policies with `/legal privacy-policy` and `/legal terms-of-service`, or see the [Terms of Service](/legal/terms-of-service/).

## 2) What we store and why

We use saved data to provide the features you choose, remember your preferences, manage paid access, and keep the service working.

### 2.1) Your account and preferences

We store your Discord user ID, privacy choices, and the profile details and preferences you choose to save. We also keep usage totals so you can view statistics for yourself, the Server, and its personas. Your saved preferences include whether personas may ping you to start a conversation (Pings from Personas).

### 2.2) Memories and Server settings

We keep personal and Server memories, persona customizations, reminders, and Server settings to provide the features you configure.

When a persona starts a conversation on its own (Natural Nudges), we record which persona spoke, the channel, whether anyone answered, and the member it pinged. We also save the persona's private goal for that conversation, which may mention that member.

Optional short-term memory saves conversation summaries. Other saved memories remain until deleted and may describe people who did not write them.

### 2.3) API keys and connected services

We store API keys, service addresses, and authentication details you provide for AI providers, custom endpoints, and MCP servers, plus links between Discord channels and Matrix rooms. The hosted service also manages credentials for subscription access. Stored credentials are encrypted.

### 2.4) Files you save

We keep the text and file details of knowledge-base documents so the bot can search them. We also store persona images and, for voice cloning, voice samples and transcripts.

### 2.5) Service records

Error and performance records help us troubleshoot problems. They can include Discord IDs, command names, and error details, but not conversations or message content. We also keep message identifiers to manage the bot's sent messages.

### 2.6) Memberships and subscription usage

Linking Patreon connects your Discord account to your Patreon membership. We receive your tier, payment status, and billing dates from Patreon to determine your benefits.

We keep sponsorships, their authorizations, allowance and spending totals, and request details such as model, feature, cost, token counts, time, and identifiers. Sponsored Server usage is associated with that Server and charged to its sponsor's allowance.

Temporary sign-in and membership-update records help secure account linking and prevent duplicate updates. Your own Patreon sign-in tokens are not kept after linking.

## 3) What we read without saving

TomoriBot temporarily reads recent messages, relevant media, Server and channel details, and available presence information to answer. This is not saved as chat history. Short-term memory summaries and files you deliberately save are handled as described above.

## 4) Who receives your data

- **AI providers:** your selected provider receives the prompt, relevant conversation context, persona information, and media needed for text, images, video, voice, or document search. Before a persona pings someone, the Server's model also receives that member's name, current activity, and recent personal memories, unless their privacy level hides those. Subscription requests use OpenRouter and the selected model's providers. We check spending with OpenRouter to enforce your allowance.
- **Patreon:** linking authorizes us to verify your membership. Patreon provides account and membership updates; Patreon and its payment providers handle payments and payment details.
- **Search providers:** when web search is used, the search provider receives search queries and relevant context.
- **Matrix:** when a bridge is configured, messages are shared between the linked Discord channel and Matrix room.
- **Hosting and storage providers:** process and store data needed to run TomoriBot.

These services may process data outside your country and have their own privacy and retention policies. We do not sell personal data; we share it to provide the features you use or where required by law.

## 5) How long we keep it

| Data | Retention |
|---|---|
| Short-term memory summaries | 90 days after last activity by default |
| Error logs | 90 days |
| Performance records and bot-message identifiers | 30 days |
| Natural Nudges records | 30 days; the persona's private goal up to 90 days |
| Patreon membership-update records | 30 days by default |
| Completed or expired Patreon sign-in records | Eligible for deletion after one hour by default |
| Detailed subscription usage | 90 days; current-period records stay until that period ends if later |
| Database recovery backups | Seven days |
| Automatic startup backups | Up to five copies; older copies are removed as new ones are made |
| Membership links, access status, sponsorships, and managed keys | While linked; contact support to request unlinking or erasure |
| Membership identifiers and allowance/spending totals kept after unlinking | 90 days after unlinking, the paid period ending, and completion of provider-key deletion, whichever is last |
| Other saved settings, memories, credentials, and uploads | Until deleted through the controls in Section 6 |

Expired records are removed during scheduled cleanup. We may keep relevant accounting records longer for a specific unresolved dispute or legal obligation, then remove them when that need ends. Spending totals may survive deletion of detailed usage. Deleted data can remain in retained backups: database recovery backups expire after seven days, while startup backups remain until replaced. Separate manual recovery or migration copies are deleted when that work is complete.

Removing the bot keeps Server data for re-invitation; run `/nuke` first to delete it. Canceling billing does not delete membership records.

## 6) Review, export, or delete your data

| What you want | Where to do it |
|---|---|
| Control message visibility and personal memory use | `/personal config` |
| Stop personas pinging you to start a conversation | `/personal config` > `Privacy` > `Pings from Personas` |
| Review or remove personal memories | `/personal memories` |
| Review or remove Server memories and documents | `/memories` |
| Export your personal settings or memories | `/export personal config`, `/export personal memories` |
| Export Server settings or memories | `/export config`, `/export memories` |
| Reset your personal settings | `/reset personal config` |
| Erase the personal data described below across Servers | `/personal nuke` |
| Erase a Server's data (managers only) | `/nuke` |

`/personal nuke` deletes your personal settings, memories, saved provider credentials and configurations, usage counts, and reminders you created or that were set for you. Deleting your feedback may also affect a persona's behavior for other members.

Your Server memories and documents stay, with your authorship removed; ask a manager to delete them with `/memories`. If a shared memory or document contains personal data about you and you cannot get it removed, contact us directly using Section 9. You do not need a manager's permission to request review and removal.

Privacy settings limit message visibility and personalization; they do not erase existing memories. Privacy opt-outs survive erasure so collection is not silently re-enabled. Your Pings from Personas choice is a personalization setting, so `/personal nuke` erases it; turn Pings from Personas off again afterwards if you still want them off.

For subscriptions, use the subscription panel to review your allowance and sponsorships or stop sponsoring a Server. Cancel renewal through Patreon; stopping sponsorship or deleting bot data does not stop billing.

Contact us using Section 9 to access, unlink, or erase subscription records; ordinary exports and `/personal nuke` do not cover them. Unlinking removes the account link, access, sponsorships, and detailed local usage, and requests deletion of the managed provider key. Limited accounting records may remain as described in Section 5.

## 7) How we protect your data

Stored access credentials are encrypted. Database connections are encrypted and verify the server's identity. Access is limited to the bot's runtime and operators with infrastructure access.

No system is completely secure. Avoid providing highly sensitive information or data subject to special handling requirements.

## 8) Children's data

TomoriBot is not directed to anyone below Discord's minimum age in their country, which is at least 13. We do not knowingly collect data from people below that age. Contact us if you believe we hold such data, and we will delete it. Some providers and subscription features have higher age requirements, as explained in the Terms of Service.

## 9) Contact

For privacy questions or requests the commands cannot handle, email `bredrumb@gmail.com` or contact us in the [official TomoriBot support Discord server](https://discord.gg/bjCfHm9QsB). Use email or a direct message for personal data or security concerns, rather than a public GitHub issue.

## 10) Changes

We announce material changes through the support Discord or project repository and update the date at the top of this policy.

## 11) International users and GDPR

If you are in the EEA, UK, or Switzerland, applicable data-protection law gives you rights to access, correct, erase, restrict, and receive a portable copy of your data, and to object to processing. Use the controls above or contact us.

We process data to fulfill our agreement with you, including providing features you request and paid benefits. We rely on legitimate interests to provide Server-configured group conversations, secure the service, prevent abuse and duplicate allowance grants, and maintain reliability, while considering members' rights and privacy choices. A manager enabling a feature does not mean every member has consented. You can use the privacy controls above or contact us to object to processing.
