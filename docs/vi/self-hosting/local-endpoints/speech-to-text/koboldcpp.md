---
title: "Phiên âm KoboldCPP"
sidebar:
  order: 3
---

Sử dụng phiên bản [KoboldCPP](https://github.com/LostRuins/koboldcpp) hiện có của bạn để chép lại tệp đính kèm âm thanh và tin nhắn thoại trong TomoriBot.

KoboldCPP bao gồm tính năng chuyển lời nói thành văn bản dựa trên Whisper. TomoriBot kết nối với KoboldCPP bằng điểm cuối phiên mã âm thanh tương thích với OpenAI (`POST /v1/audio/transcriptions`).

## Cài đặt

Khởi động KoboldCPP với Whisper/STT được bật và xác nhận bản dựng của bạn cung cấp:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` hoặc `GET /models`

Giữ KoboldCPP chạy trong khi TomoriBot đang sử dụng. Nếu bản dựng của bạn chỉ cung cấp `/api/extra/transcribe` hoặc cấu trúc tùy chỉnh khác, hãy sử dụng một wrapper cho đến khi TomoriBot có bộ chuyển đổi chuyên dụng.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: thư mục gốc máy chủ KoboldCPP của bạn

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm tên model mà
máy chủ của bạn báo cáo dưới dạng model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản ghi

Sau khi đăng ký, TomoriBot sẽ chép lại các tệp đính kèm âm thanh ở chế độ nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Engine > Thông báo nếu bạn cũng muốn bản ghi được đăng rõ ràng trong cuộc trò chuyện.
