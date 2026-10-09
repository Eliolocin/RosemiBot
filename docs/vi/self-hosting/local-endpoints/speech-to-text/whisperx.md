---
title: "Phiên âm WhisperX"
sidebar:
  order: 1
---

Thiết lập tính năng chuyển giọng nói thành văn bản cục bộ, chính xác cho TomoriBot bằng máy chủ [WhisperX](https://github.com/m-bain/whisperX) đi kèm. WhisperX cung cấp khả năng sao chép âm thanh nhanh chóng với khả năng căn chỉnh theo cấp độ từ.

## Cài đặt

Chạy các lệnh này từ kho lưu trữ gốc TomoriBot:

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

Giữ thiết bị đầu cuối đó mở trong khi TomoriBot đang sử dụng WhisperX. URL điểm cuối mặc định là `http://127.0.0.1:8021`.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm `large-v3`, hoặc
bất kỳ giá trị nào mà `WHISPERX_MODEL` được thiết lập, làm model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản ghi

Sau khi đăng ký, TomoriBot sẽ chép lại các tệp đính kèm âm thanh ở chế độ nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Engine > Thông báo nếu bạn cũng muốn bản ghi được đăng rõ ràng trong cuộc trò chuyện.
