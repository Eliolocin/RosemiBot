---
title: Terms of Service
description: The terms governing use of the official hosted TomoriBot instance.
aiGenerated: false
---

Last updated: 2026-10-22

By setting up or interacting with TomoriBot, you accept these Terms and Discord's Terms of Service and Community Guidelines. These Terms apply to the official hosted TomoriBot instance on Discord. If you run your own copy from TomoriBot's open-source repository, you are not bound by these Terms; your use is governed by the AGPLv3 license in `LICENSE` instead, and you alone control data handling in your self-hosted environment.

## 1) Definition of Terms
For clarity, these terms are used throughout this document:
- **Server**: A Discord guild/community where TomoriBot is set up
- **Memories**: Facts or information taught to TomoriBot via commands, or self-taught through the `remember_this_fact` function tool
- **Persona/Preset**: Configurable personality and behavioral profiles that change how TomoriBot responds
- **Provider**: Third-party AI or search services (e.g., Google, NovelAI, OpenRouter, Brave Search) used to process requests through TomoriBot
- **Hosted Instance**: The official TomoriBot service maintained as a public bot for Discord, as opposed to self-hosted copies
- **API Key**: Authentication credentials that connect TomoriBot to a Provider, supplied by you or managed by the hosted service for subscription access
- **Subscription**: Paid membership benefits that provide an AI usage allowance through the hosted instance
- **Sponsorship**: A member's authorization for a Server to share that member's subscription allowance
- **Trigger**: An event that causes TomoriBot to generate a response using a configured Provider, such as: mentioning the bot, replying to its messages, using slash commands that require AI/search processing, or sending messages in channels where auto-reply is enabled. Triggers consume usage funded by the selected personal API key, Server API key, or subscription allowance.
- **Server Manager**: A member with permission to configure TomoriBot for a Server, such as the member who runs `/setup`

## 2) Scope of Service
- TomoriBot is an AI-powered chatbot that responds to Discord interactions using external Providers. Access may use API keys you supply or a subscription allowance managed by the hosted service.
- We may change, suspend, or end features of TomoriBot at any time for maintenance, safety, or legal reasons.

## 3) Who Accepts What
- A Server Manager accepts these Terms for the Server when completing `/setup`, and confirms there that they have read the Privacy Policy and will make that information available to the Server's members.
- A Server Manager cannot accept these Terms on another member's behalf, and does not warrant any other member's age or conduct. Each member accepts these Terms for themselves by interacting with TomoriBot.
- Members can read the current documents at any time with `/legal terms-of-service` and `/legal privacy-policy`.
- These Terms apply to personal use, Server use, and sponsored requests, including requests by members who have no Patreon account or subscription of their own.
- Server Managers must tell members about TomoriBot, how it processes messages, and the applicable age and use restrictions. They are responsible for using reasonable channel and role controls to manage access and where TomoriBot reads messages, and for responding to reports of ineligible or prohibited use.

## 4) Your Responsibilities
- Do not use TomoriBot for unlawful, harmful, or platform-disallowed content, harassment, or unauthorized access attempts.
- Do not use TomoriBot to create or request sexual content involving minors or sexual depictions of real people. This restriction applies across all Providers and funding sources.
- You must meet the minimum age Discord requires in your country, which is at least 13, to use TomoriBot. By using the service, you represent that you meet this age requirement.
- You remain responsible for content you provide (messages, memories, persona data, uploads). Ensure you have rights to share it, and avoid sensitive data you do not want processed by your configured Providers.
- Only upload voice samples you have permission to use and clone. Do not use cloned voices or impersonation to deceive, harass, or defraud people.
- Respect rate limits and avoid spam or abuse that degrades the service.

## 5) Age-Restricted Content
- Features that produce adult content are off by default and must be deliberately enabled by a Server Manager.
- A Server Manager who enables them confirms that they are 18 or older and that the content will be confined to channels Discord marks as age-restricted, which are accessible only to adults.
- Content that is prohibited by Discord's Community Guidelines or by law remains prohibited regardless of any setting, channel marking, or age confirmation.
- We may disable these features for a Server, or remove access entirely, where they appear to be reaching minors or producing prohibited content.

## 6) Third-Party Providers and Models
- You may use external Providers through TomoriBot (e.g., Anthropic, Google Gemini, OpenAI, OpenRouter, NovelAI, Brave Search). Their terms, privacy policies, safety filters, and applicable model terms govern the content processed through them.
- All users must comply with the terms, age requirements, and use restrictions of each Provider and model they use, whether funded by personal keys, Server keys, or sponsorship.
- TomoriBot is not affiliated with, endorsed by, or sponsored by Discord or any of these Providers. We are an independent service that integrates with their APIs.
- We cannot control the behavior, retention, or safety policies of those Providers.
- AI-generated content may be inaccurate, biased, or inappropriate despite safety filters. TomoriBot does not verify or endorse AI outputs.

## 7) API Keys and Billing

### 7.1) Keys you supply

- If you supply API keys for AI/search providers, you authorize TomoriBot to store and use them to fulfill your requests. All provided keys are encrypted at rest.
- You must only provide API keys that you are legally authorized to use. This means keys obtained directly from the provider under your own account, or keys explicitly authorized for your use by the account holder. The following are strictly prohibited:
  - Stolen, leaked, or compromised API keys
  - Keys purchased from unauthorized third parties or black markets
  - Keys shared in violation of the provider's terms of service
- You assume all legal responsibility for the legitimacy of API keys you provide.
- We use your API keys for the features you configure for yourself or your Server. Personal Providers can fund your requests across Servers, including automatic replies; Server keys can fund requests from that Server's members. We do not use your keys for unrelated users, development, or analytics.
- You are responsible for all provider-side costs and account usage caused by each TomoriBot Trigger associated with your API key. Monitor your API key dashboards for usage and billing. The `/tool estimate cost` command provides a rough estimate of per-trigger costs.
- We recommend using API keys with minimal required permissions, and provider-side rate limits and spending caps where available.

### 7.2) Subscription allowances and sponsorship

TomoriBot uses OpenRouter to process subscription-funded requests. Everyone using this allowance, including members of sponsored Servers, must be at least 18 and comply with [OpenRouter's terms](https://openrouter.ai/terms) and the [applicable model terms](https://openrouter.ai/docs/guides/routing/provider-selection#terms-of-service).

- Subscriptions fund the hosted bot's supported features through one allowance shared by your personal use and every Server you sponsor. Tier descriptions state the price and allowance; hosted API keys are not supplied for use elsewhere.
- Subscription-funded usage stops when the allowance is exhausted and refills after a confirmed paid renewal. Unused allowance does not roll over. Changing models or refreshing membership does not refill it.
- Confirmed paid upgrades add only the increase above the highest allowance already granted that period, without resetting spending or changing the period's dates. Downgrades reduce the allowance at the next paid renewal.
- Canceling renewal preserves access through the confirmed paid-through date. Failed payment, refunds, loss of eligibility, or a violation of these Terms may end access sooner.
- Provider prices and actual usage determine consumption; reply or generation counts are estimates. Failed or canceled requests may still incur charges and reduce your allowance.
- Manage payments and cancel renewal through Patreon under [its terms](https://www.patreon.com/policy/legal). We review [refund requests submitted through Patreon](https://support.patreon.com/hc/en-us/articles/360021113811-How-to-request-a-refund); Patreon or the purchasing app store may also review claims under their own policies. Contact us using Section 12 for questions about TomoriBot benefits.

## 8) Data Handling
- Data collected, retention periods, and usage purposes are described in the [Privacy Policy](/legal/privacy-policy/).
- You can export or erase personal and Server data with the commands listed in that document. Subscription records have separate controls and may require a request to support. `/personal nuke` and `/nuke` do not cancel a Patreon membership.
- Content owned by a Server, such as Server memories and uploaded documents, survives a personal erasure with your authorship removed. Ask a Server Manager to remove specific entries with `/memories`, or contact us using Section 12 if you cannot resolve a concern about your personal data with them.
- Some operational records may persist for their stated retention period, or longer where required by law or for security.

## 9) Availability, Support, and Changes
- Service availability is not guaranteed. Outages, maintenance, or rate limits may interrupt responses.
- We may update these Terms as the service develops or to address legal, security, or operational needs. We will announce material changes through the support Discord or project repository and provide reasonable advance notice where they adversely affect existing users. Urgent legal or security changes may take effect immediately. Where changes affect paid subscription benefits, we will notify affected members before they apply and explain how to cancel renewal. Any longer notice required by law will apply.

## 10) Termination
- We may suspend or remove access for violations of these Terms, legal requirements, or safety/security concerns.
- You may remove TomoriBot at any time. Consider running `/nuke` before removal, since a Server's data is otherwise kept so the configuration survives a re-invitation.

## 11) Disclaimers and Liability
- The service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind. We disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted availability.
- We encrypt credentials at rest, use TLS with certificate verification for database connections, and restrict database access to the bot's runtime and operators with infrastructure access. No system is completely secure, and we cannot guarantee protection against all threats, breaches, or unauthorized access.
- To the maximum extent permitted by law, we are not liable for:
  - Indirect, incidental, consequential, or punitive damages
  - Actions of third-party providers or users
  - Unauthorized access to, theft of, corruption of, or loss of any data stored by TomoriBot (including API keys, memories, personas, and configurations)
  - Any damages except in cases of gross negligence or intentional misconduct on our part
- Our total liability is limited to the greater of (a) amounts you paid us for the service, including subscription benefits, or (b) $10 USD in aggregate for all claims.
- By using the hosted TomoriBot service, you accept these risks. If you are uncomfortable with them, consider self-hosting TomoriBot from the open-source repository, where you maintain full control over data storage, encryption, and security practices.
- Nothing in these Terms limits rights that cannot be limited under the law that applies to you.

## 12) Reports and Contact
- For questions, abuse reports, security reports, or a report that TomoriBot holds data about someone below the applicable minimum age, email `bredrumb@gmail.com` or reach us in the [official TomoriBot support Discord server](https://discord.gg/bjCfHm9QsB).
- Please use email or a direct message rather than a public GitHub issue for anything involving personal data or a security vulnerability.
