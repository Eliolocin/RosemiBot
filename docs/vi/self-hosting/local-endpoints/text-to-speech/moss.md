---
title: "MOSS-TTS"
---

Đánh giá cục bộ việc sao chép giọng nói và thiết kế giọng nói bằng ngôn ngữ tự nhiên thông qua điểm cuối giọng nói thống nhất bằng cách sử dụng [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

Bằng cách sử dụng `servers/tts/moss/server.py`, TomoriBot định tuyến các yêu cầu tổng hợp một cách linh hoạt: nó tải model nhân bản khi một cá nhân cung cấp `ref_audio` và chuyển sang MOSS-VoiceGenerator khi được hướng dẫn `instruct` bằng ngôn ngữ tự nhiên. Tại một thời điểm, chỉ có một kiểu máy được giữ trong bộ nhớ GPU để chạy trong ngân sách VRAM 16 GB.

Model nhân bản mặc định là [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), được chọn làm đường cơ sở thực tế cho GPU 16 GB. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) là giải pháp thay thế hàng đầu 8B yêu cầu nhiều VRAM hơn ở BF16. Thiết kế giọng nói sử dụng [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (khoảng 1,7B). Việc chuyển đổi giữa nhân bản và thiết kế giọng nói sẽ gây ra độ trễ khi tải model.

## Cài đặt

Chạy các lệnh từ kho lưu trữ gốc TomoriBot bằng Python 3.12 và trình điều khiển tương thích với CUDA 12.8:

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux hoặc WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

Lệnh tìm nạp trước tải model nhân bản, VoiceGenerator và mã thông báo âm thanh vào bộ đệm Hugging Face của bạn trước khi khởi động máy chủ. Nếu dung lượng ổ đĩa bị giới hạn, hãy đặt `HF_HOME` thành phân vùng lớn hơn. Để chỉ tải xuống một kiểu máy, hãy chuyển `--mode clone` hoặc `--mode voice-design`.

Điểm cuối mặc định là `http://127.0.0.1:8018`. Chạy `bun run launch --moss` để khởi chạy máy chủ cùng với TomoriBot. Chế độ tự động làm ấm trước model nhân bản từ bộ nhớ đệm cục bộ. Thay vào đó, hãy đặt `MOSS_TTS_WARM_MODE=voice-design` để làm ấm trước VoiceGenerator hoặc `MOSS_TTS_WARM_MODE=none` để khởi tạo từng phần. Kiểm tra `GET /health` để tìm `warm_mode`, `active_mode` và `model_id` đang hoạt động. Trình bao bọc sử dụng Ôm mặt `trust_remote_code=True`, vì vậy hãy xem lại mã ngược dòng trước khi cập nhật.

## Đăng ký trong TomoriBot

Trong `/providers`, chọn `Add New Custom Endpoint`, đặt Khả năng tương thích API thành `tts-clone` và sử dụng URL điểm cuối `http://127.0.0.1:8018`. Thêm model Lời nói với `Chế độ nguồn giọng đọc` được đặt thành `Tự động` và `Script Markup` được đặt thành `Thuần văn bản`. Kích hoạt nó trong `/config` > `Model` > Switch Models.

Để sao chép giọng nói, hãy tải lên một clip tham chiếu rõ ràng trong `/config` > `Model` > TTS Parameters & Voices và gán nó trong Persona > `Giọng nói`. Các đoạn âm thanh ngắn hơn, rõ ràng hơn sẽ mang lại kết quả nhất quán nhất. Đối với thiết kế giọng nói, hãy lưu mô tả bằng ngôn ngữ tự nhiên trong Persona > `Giọng nói`. Lưu ý rằng MOSS-VoiceGenerator được thiết kế cho tiếng Anh và tiếng Trung. Trong khi model nhân bản 4B hỗ trợ tiếng Nhật, các thẻ ngôn ngữ rõ ràng sẽ cải thiện độ rõ ràng của quá trình tổng hợp.

Bộ điều hợp nhân bản của TomoriBot không tự động gửi thẻ ngôn ngữ. Để sử dụng một ngôn ngữ, hãy đặt `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (hoặc `Tiếng Việt`, `Chinese`, v.v.) trước khi khởi động máy chủ. Các cuộc gọi `/synthesize` thủ công có thể chuyển trực tiếp `language`.

Máy chủ đọc môi trường shell của chính nó; cài đặt trong `.env` của bot không áp dụng cho thiết bị đầu cuối Python được khởi động độc lập.

Để chạy model 8B trên phần cứng bộ nhớ cao, hãy đặt `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` trước khi tìm nạp trước. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` và `MOSS_TTS_MAX_NEW_TOKENS` có thể định cấu hình trong `.env.optional.example`. Tăng `TTS_SYNTHESIZE_TIMEOUT_MS` trong TomoriBot nếu việc hoán đổi model hoặc việc thực thi CPU gây ra thời gian chờ.
