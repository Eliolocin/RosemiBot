---
title: "Tạo video"
sidebar:
  order: 2
---

TomoriBot có thể tạo các video ngắn từ lời nhắc văn bản hoặc bằng cách tạo hoạt ảnh cho hình ảnh hiện có. Sử dụng `/generate video` hoặc hỏi trực tiếp cô ấy trong cuộc trò chuyện.

## Những việc bot có thể làm

- **Chuyển văn bản thành video**: tạo một đoạn clip ngắn từ phần mô tả.
- **Chuyển hình ảnh thành video**: tạo hiệu ứng động cho hình ảnh. Hình ảnh đầu tiên từ tin nhắn được tham chiếu sẽ trở thành khung bắt đầu.
- **Lặp từ hình ảnh sang video**: khi được yêu cầu thông qua trò chuyện, các kiểu máy được hỗ trợ có thể sử dụng lại hình ảnh bắt đầu làm khung hình cuối cùng.
- **Tỷ lệ khung hình có thể tùy chỉnh**.

Chuyển đổi hình ảnh thành video và lặp lại tùy thuộc vào khả năng hỗ trợ khung hình đầu tiên và cuối cùng của model đã chọn. TomoriBot kiểm tra danh mục model của OpenRouter trước khi gửi thế hệ và nhắc bạn xem có cần xóa hình ảnh hoặc vòng lặp cho model đã chọn hay không.

Việc tạo video cần có thời gian: TomoriBot gửi công việc cho nhà cung cấp, kiểm tra mức độ hoàn thành ở chế độ nền và đăng video đã hoàn thành lên kênh khi sẵn sàng.

## Thiết lập

1. Chọn kiểu video trong `/config` > `Model` > Chuyển đổi kiểu máy.
2. Xác nhận việc tạo video được bật trong `/config` > `Quyền hạn` (`video_generation_enabled`).
3. Hỏi cô ấy trong phần trò chuyện hoặc chạy `/generate video`.

## Hỗ trợ nhà cung cấp

Tạo video gốc có sẵn trên Google, OpenRouter và Z.ai. Xem ma trận đầy đủ trong [Nhà cung cấp & Model](/vi/features/setup-administration/providers-and-models/#supported-providers).

Để tạo video cục bộ qua ComfyUI (chẳng hạn như quy trình chuyển hình ảnh sang video WAN), hãy xem [Thiết lập: ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/).

Để biết kiến trúc tạo nội bộ và thăm dò ý kiến, hãy xem tài liệu tham khảo về [tạo video](/en/architecture/subsystems/video-generation/).
