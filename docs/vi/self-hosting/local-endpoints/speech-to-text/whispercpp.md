---
title: "Phiên âm whisper.cpp"
sidebar:
  order: 2
---

Chạy tính năng chuyển giọng nói thành văn bản nhẹ, hiệu suất cao cho TomoriBot bằng cách sử dụng [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

TomoriBot kết nối với thì thầm.cpp thông qua điểm cuối phiên mã âm thanh tương thích với OpenAI (`POST /v1/audio/transcriptions`).

## Cài đặt

Khởi động máy chủ HTTP whisper.cpp của bạn và xác nhận máy chủ cung cấp endpoint phiên âm tương thích OpenAI:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` hoặc `GET /models`

Giữ máy chủ chạy trong khi TomoriBot đang sử dụng. URL của endpoint là thư mục gốc của máy chủ, chẳng hạn như `http://127.0.0.1:8022`.

Nếu bản dựng whisper.cpp của bạn cung cấp một cấu trúc endpoint khác, hãy đặt một wrapper mỏng phía trước để ánh xạ các yêu cầu sang cấu trúc tương thích OpenAI mà TomoriBot yêu cầu.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: thư mục gốc máy chủ whisper.cpp của bạn

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm tên model mà
máy chủ của bạn báo cáo dưới dạng model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản ghi

Sau khi đăng ký, TomoriBot sẽ chép lại các tệp đính kèm âm thanh ở chế độ nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Engine > Thông báo nếu bạn cũng muốn bản ghi được đăng rõ ràng trong cuộc trò chuyện.
