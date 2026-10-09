---
title: "Qwen3-TTS"
aiGenerated: true
---

Tổng hợp giọng nói của ký tự đa ngôn ngữ có độ chính xác cao bằng cách sử dụng [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) ở cả chế độ sao chép giọng nói và chế độ VoiceDesign được mô tả bằng văn bản.

Qwen3-TTS 12Hz 1.7B cung cấp khả năng tổng hợp giọng nói cục bộ có độ chính xác cao. Chạy `servers/tts/qwen3tts/server.py` ở chế độ tự động mặc định sẽ tự động chọn model nhân bản giọng nói cơ bản hoặc model VoiceDesign dựa trên từng yêu cầu đến.

## Cài đặt

Chạy các lệnh này từ thư mục gốc repo TomoriBot, thư mục nơi bạn đã sao chép TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux và macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

URL điểm cuối của chế độ tự động mặc định là `http://127.0.0.1:8012`; đặt `QWEN3TTS_PORT` để sử dụng cổng khác. Bạn cũng có thể chỉ định rõ ràng chế độ tự động:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

Chế độ tự động kiểm tra từng yêu cầu `/synthesize`: các yêu cầu với `ref_audio` sử dụng model sao chép, trong khi các yêu cầu với `instruct` sử dụng model VoiceDesign. Nó chỉ tải một model tại một thời điểm và hoán đổi các model khi loại yêu cầu thay đổi, do đó yêu cầu đầu tiên sau khi hoán đổi có thể chậm hơn.

## Đăng ký trong TomoriBot

Đối với hầu hết người dùng, hãy đăng ký máy chủ ở chế độ tự động để một endpoint có thể hỗ trợ cả persona sao chép giọng nói lẫn persona VoiceDesign.

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm một model Speech. Biểu mẫu model yêu cầu Chế độ nguồn giọng đọc và Script Markup; hãy chọn `Auto` và `Plain` cho máy chủ ở chế độ tự động.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói cá nhân

### Nhân bản giọng nói

Sử dụng tùy chọn này cho những cá tính bắt chước một clip tham khảo:

1. Chuẩn bị một đoạn thoại rõ ràng dài 10-20 giây với một loa và không có nhạc nền.
2. Mở `/config` trong Models > `Tham số & Giọng đọc TTS` và tải clip lên.
3. Mở `/config` trong Persona > `Giọng nói`, sau đó chọn persona và mẫu giọng nói.

Qwen3-TTS quảng cáo sao chép nhanh chóng chỉ từ 3 giây âm thanh tham chiếu và thời gian chạy của nó không ghi lại cũng như không thực thi giới hạn thời lượng tham chiếu. Do đó, độ dài clip là sự đánh đổi về chất lượng mà bạn kiểm soát chứ không phải là giới hạn mà máy chủ kiểm tra.

### Thiết kế giọng nói

Sử dụng tùy chọn này cho những cá nhân cần sử dụng mô tả giọng nói bằng văn bản thay vì mẫu:

1. Mở `/config` trong Persona > `Giọng nói` và chọn VoiceDesign.
2. Chọn persona.
3. Nhập lời nhắc bằng ngôn ngữ tự nhiên, chẳng hạn như tuổi, giọng điệu, giọng điệu và cách truyền tải của người nói.

Xóa lời nhắc VoiceDesign của một người khỏi Persona > `Giọng nói` trong `/config`. Trong quá trình tạo, TomoriBot gửi lời nhắc đã lưu trong nội dung JSON `/synthesize` dưới dạng `instruct`; `voice_instructions` một lần từ công cụ sẽ được thêm vào.

Chế độ tự động giữ cả hai thiết lập. Các Persona được định cấu hình trong Persona > `Giọng nói` trong `/config` sử dụng tổng hợp bản sao hoặc tổng hợp VoiceDesign theo lựa chọn của họ.

## Tùy chọn: Máy chủ chỉ dành cho VoiceDesign

Khởi động cùng một máy chủ ở chế độ VoiceDesign khi phục vụ `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

Windows PowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Đánh:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

Bạn cũng có thể chuyển `--mode voice-design` thay vì đặt `TOMORI_TTS_MODE`. URL điểm cuối chỉ dành cho VoiceDesign mặc định là `http://127.0.0.1:8014`.

Đăng ký theo cách tương tự như chế độ tự động, nhưng sử dụng URL điểm cuối `http://127.0.0.1:8014` và chọn `VoiceDesign` làm Chế độ nguồn giọng nói trên mẫu Lời nói.
