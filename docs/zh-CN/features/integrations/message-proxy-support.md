---
title: "消息代理支持"
description: "选择支持的 Discord 消息代理服务，让 TomoriBot 安全跟踪已验证的 Webhook 重发消息。"
sidebar:
  order: 3
---

消息代理支持让 TomoriBot 能够跟踪外部 Discord bot 通过 Webhook 删除并重新发送的消息。

## 选择服务

运行 `/personal message-proxy service:pluralkit` 或 `/personal message-proxy service:pluralbuddy`。选择 `service:none`（显示为「关闭」）以停用代理处理。这是发送原始消息的 Discord 账号的个人设置，并跟随该账号跨服务器生效。

在 TomoriBot 看到某位副人格的第一条验证消息后，可以使用 `/personal config identity:` 编辑其资料，并使用 `/personal memories identity:` 编辑其记忆。即使代理处理处于关闭状态，自动补全也会包含来自这两个服务的已存储身份。账号界面、隐私与模型设置仍保留在宿主账号上。在 TomoriBot 中设置的昵称会一直保留到被清除为止；否则服务的显示名称会在收到验证消息时刷新。关于成员与简介详情，请参阅 [PluralKit 支持](/zh-CN/features/integrations/pluralkit-support/)。

## 安全检查的意义

Tomori 绝不会从 Webhook 的名称或头像推断身份。所选的服务必须验证重发 ID、宿主账号以及稳定的副人格 ID。PluralKit 还能识别确切的原始消息，因此 TomoriBot 可以转移其触发判定与回复目标。PluralBuddy 不提供该原始 ID。TomoriBot 会采用尽力而为的方式，匹配来自同一宿主与频道的近期消息。如果重发消息在原始等待时间结束后才到达，或者有多个原始消息重叠，重发消息可能会被忽略或引起第二次回复。验证失败或发生冲突时绝不会创建身份。

这就是为什么目前没有将 Tupperbox 作为选项提供的原因。其公开文档虽描述了代理机制，但并未提供 TomoriBot 可以安全使用的公开权威消息证明 API。

## 短暂的消息延迟

选择服务后，Tomori 在处理来自你账号的每条普通服务器消息前会稍作等待。这为服务留出了删除并重新发送的时间。未被代理的消息在等待后继续处理。PluralKit 重发消息会继承原始触发判定与回复目标。PluralBuddy 则使用已验证的重发内容与尽力而为的近期消息匹配。

自部署用户可以通过 `MESSAGE_PROXY_WAIT_MS` 调整此机制。服务传输设置保持独立，例如 PluralKit 的 API 超时与可选令牌。PluralBuddy 消息查询需要在部署中配置 OAuth 应用凭据：`PLURALBUDDY_CLIENT_ID` 与 `PLURALBUDDY_CLIENT_SECRET`。单个用户无需提供令牌。当前的适配器仅查询 `pluralbuddy.app`；不支持自部署的 PluralBuddy 实例。
