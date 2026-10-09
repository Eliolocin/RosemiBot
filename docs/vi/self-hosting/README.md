---
title: "Self-hosting"
head:
  - tag: title
    content: "TomoriBot | Tự host bot Discord AI mã nguồn mở miễn phí"
description: "Dễ dàng self-host bot Discord AI hoàn toàn cục bộ và riêng tư với KoboldCPP, ComfyUI cùng nhiều công cụ khác."
sidebar:
  label: "Tổng quan"
  groupLabel: "Self-hosting"
  order: 3
aiGenerated: false
---

<!-- STUB (Phase 1 structural). Phase 2 writes: requirements + module directory.
     Source for manual-setup.md: `git show HEAD:README.md` "Self-Hosting" section. -->

Bắt đầu chạy phiên bản TomoriBot của riêng bạn thông qua bất kỳ phương thức cài đặt nào dưới đây:

1. [`setup-wizard`](/vi/self-hosting/setup-wizard/): cài đặt có hướng dẫn bằng `bun run setup`
2. [`manual-setup`](/vi/self-hosting/manual-setup/): quy trình thủ công dành cho người dùng kỹ thuật
3. [`docker-compose`](/vi/self-hosting/docker-compose/): bot cùng cơ sở dữ liệu đóng gói trong container, không cần cài Bun/PostgreSQL trên máy chủ lưu trữ

Các mô-đun tùy chọn (LLM cục bộ, ComfyUI, SearXNG, Crawl4AI, TTS/STT cục bộ, ChatMock,
máy chủ MCP cục bộ) đều có trang hướng dẫn riêng, xem
[`local-endpoints`](/vi/self-hosting/local-endpoints/) để xem danh mục đầy đủ.

Khi bot đã hoạt động, [`maintenance`](/vi/self-hosting/maintenance/) sẽ hướng dẫn về các script phía máy chủ lưu trữ, cách cập nhật,
cũng như sao lưu và khôi phục cơ sở dữ liệu của bạn.
