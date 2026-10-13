---
title: "IrodoriTTS"
aiGenerated: true
---

Tạo giọng nói tiếng Nhật tự nhiên bằng tính năng sao chép giọng nói, VoiceDesign dựa trên chú thích và đánh dấu biểu tượng cảm xúc biểu cảm bằng [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 là model chuyển văn bản thành giọng nói tập trung vào tiếng Nhật, hỗ trợ cả sao chép giọng nói và VoiceDesign được mô tả văn bản trong một điểm kiểm tra duy nhất. TomoriBot kết nối với Irodori thông qua trình bao bọc FastAPI cục bộ trong `servers/tts/irodoritts/`, mặc định là `Aratako/Irodori-TTS-v4.1-Small`.

Các điểm kiểm tra ôm mặt tương thích có thể được chọn bằng `IRODORI_TTS_MODEL_ID`, bao gồm các tinh chỉnh cộng đồng như `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Cài đặt

Irodori sử dụng `uv` để quản lý phụ thuộc và phụ trợ PyTorch. Máy chủ duy trì `pyproject.toml` của riêng nó với các phần phụ thuộc Irodori và `dacvae` được ghim để cài đặt có thể lặp lại. Trước tiên hãy cài đặt `uv`, sau đó chạy tập lệnh thiết lập từ thư mục gốc của kho lưu trữ TomoriBot:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

Các tập lệnh thiết lập tạo `servers/tts/irodoritts/.venv`, do đó `bun run launch --irodoritts` tiếp tục hoạt động sau khi cài đặt.

Phụ trợ có sẵn:

- `cu128`: NVIDIA CUDA 12.8 trên Windows và Linux
- `cpu`: CPU/MPS chỉ dành cho CPU hoặc macOS thông qua PyPI
- `rocm`: AMD ROCm trên Linux/WSL
- `xpu`: Intel XPU trên Windows và Linux

URL điểm cuối mặc định là `http://127.0.0.1:8013`.

## Sử dụng một điểm kiểm tra khác

Mẫu mặc định là `Aratako/Irodori-TTS-v4.1-Small`. Các kho lưu trữ Hugging Face tương thích, các tinh chỉnh cộng đồng (chẳng hạn như `phasefield-audio/Irodori-TTS-v4.1-Anime`) hoặc các tệp điểm kiểm tra cục bộ có thể được định cấu hình thông qua các biến môi trường.

Khi bạn khởi động máy chủ (trực tiếp bằng Python hoặc qua `bun run launch --irodoritts`), nó sẽ tự động đọc kho lưu trữ gốc `.env` (hoặc `.env` cục bộ trong `servers/tts/irodoritts/`) và ghi lại ID model hoạt động khi khởi động.

### Qua `.env` (liên tục)

Thêm vào `.env` của bạn trong thư mục gốc TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Thông qua biến môi trường mỗi phiên

Trong Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

Trên Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Sử dụng tệp điểm kiểm tra cục bộ

Nếu bạn đã tải xuống tệp điểm kiểm tra (`.pt` hoặc `.safetensors`) cục bộ, hãy đặt `IRODORI_TTS_CHECKPOINT` theo đường dẫn của nó:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

Irodori hiện tại tải xuống điểm kiểm tra cùng với bất kỳ nội dung mã thông báo nào được gói trong kho lưu trữ Ôm mặt. Các biến thể của thư mục con Ôm Mặt cũng được `IRODORI_TTS_MODEL_ID` hỗ trợ khi kho model cung cấp chúng.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Add New Custom Endpoint` và sử dụng khả năng tương thích API của giọng nói:

- Khả năng tương thích API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng model thả xuống của nó để thêm model Lời nói. Đối với v4.1, cài đặt được đề xuất là:

- `Chế độ nguồn giọng đọc`: `Tự động`
- `Kiểu định dạng kịch bản`: `Emoji`

`Tự động` cho phép cùng một điểm cuối Irodori hỗ trợ cả hai chế độ giọng nói TomoriBot, để các tín hiệu cảm xúc vẫn tồn tại khi gửi:

- Các cá nhân có mẫu giọng nói được chỉ định trong Persona > `Giọng nói` sẽ gửi một clip tham chiếu được lưu trữ để nhân bản giọng nói.
- Persona có lời nhắc VoiceDesign được đặt trong Persona > `Giọng nói` gửi lời nhắc bằng ngôn ngữ tự nhiên đã lưu dưới dạng điều hòa phụ đề Irodori.

Bạn vẫn có thể chọn `Sao chép giọng đọc` làm Chế độ nguồn giọng nói nếu bạn chỉ muốn sao chép giọng nói âm thanh tham chiếu.

Sử dụng `/providers` để đăng ký điểm cuối và thiết lập model. Sau đó mở `/config` > `Model` > Switch Models để chọn và kích hoạt điểm cuối đã đăng ký.

## Thiết lập giọng nói cá nhân

### Nhân bản giọng nói

1. Chuẩn bị một đoạn giọng nói tiếng Nhật rõ ràng với một loa và không có nhạc nền. Khoảng 30 giây là đủ: qua thời điểm đó, âm thanh bổ sung sẽ mua được ít độ trung thực của âm sắc trong khi tiêu tốn kích thước tải lên và thời gian suy luận.
2. Mở `/config` trong Models > `Tham số & Giọng đọc TTS` và tải clip lên.
3. Mở `/config` trong Persona > `Giọng nói`, sau đó chọn persona và mẫu giọng nói.

Irodori v4.1 hỗ trợ điều hòa tham chiếu lâu hơn so với các mẫu trước đó, nhưng âm thanh nguồn sạch vẫn quan trọng hơn thời lượng thô.

Thời gian chạy v4.1 giới hạn clip tham chiếu ở điểm kiểm tra mặc định, điểm kiểm tra v4.1 đặt thành 120 giây. Bất cứ điều gì dài hơn sẽ được cắt bớt đến giới hạn đó thay vì bị từ chối và `IRODORI_MAX_REF_SECONDS` sẽ ghi đè nó. Do đó, một clip ở giới hạn tải lên tối đa 130 giây của TomoriBot vẫn hoạt động: Irodori điều kiện trong 120 giây đầu tiên của clip đó.

Clip dài hơn không cải thiện chất lượng giọng nói. Báo cáo ngược dòng cho thấy khoảng 30 giây bài phát biểu tham chiếu rõ ràng đã thu được hầu hết mức tăng về độ tương tự của người nói có thể đo lường được và nhiều clip ngắn hơn từ cùng một người nói sẽ đánh bại một bản ghi âm dài. Các bước tiềm ẩn tham chiếu bổ sung đi kèm với clip dài hơn cũng kéo dài mọi yêu cầu tổng hợp. Chỉ vượt quá 30 giây khi âm sắc của người nói trôi qua bản ghi âm.

### Thiết kế giọng nói

1. Mở `/config` trong Persona > `Giọng nói`.
2. Chọn persona.
3. Nhập mô tả bằng ngôn ngữ tự nhiên của giọng nói và cách truyền tải mong muốn.

TomoriBot gửi lời nhắc này dưới dạng `instruct`; trình bao bọc Irodori ánh xạ nó tới điều kiện `caption` v4.1. Yêu cầu VoiceDesign không yêu cầu clip tham chiếu được lưu trữ.

TomoriBot loại bỏ cú pháp biểu tượng cảm xúc tùy chỉnh của Discord trước khi gửi văn bản tới TTS. Với `script_markup: emoji`, biểu tượng cảm xúc Unicode được giữ nguyên để điều hòa văn bản của Irodori.

### Điều khiển kiểu biểu tượng cảm xúc

IrodoriTTS hỗ trợ chú thích biểu tượng cảm xúc trong văn bản đầu vào để tác động đến hiệu ứng âm thanh, phong cách nói và biểu cảm cảm xúc. Khi `Kiểu định dạng kịch bản` của TomoriBot được đặt thành `Emoji`, các biểu tượng cảm xúc Unicode này sẽ được giữ nguyên và gửi tới Irodori.

| Biểu tượng cảm xúc | Ý nghĩa/cảm xúc/phong cách |
| --- | --- |
| 👂 | Thì thầm, âm thanh gần tai |
| 😮‍💨 | Hơi thở, tiếng thở dài, hơi thở ngủ |
| ⏸️ | Tạm dừng, im lặng |
| 🤭 | Cười khúc khích, cười khúc khích, cười nén |
| 🥵 | Thở hổn hển, rên rỉ, rên rỉ |
| 📢 | Tiếng vọng, hồi âm |
| 😏 | Trêu chọc, ngọt ngào tinh nghịch/dỗ dỗ |
| 🥺 | Giọng nói run rẩy, rụt rè/không chắc chắn |
| 🌬️ | Khó thở, thở nặng nhọc |
| 😮 | thở hổn hển |
| 👅 | Tiếng liếm, tiếng nhai, tiếng ướt |
| 💋 | Âm môi/tiếng môi |
| 🫶 | Nhẹ nhàng, dịu dàng |
| 😭 | Khóc, khóc lóc, buồn bã/buồn bã |
| 😱 | Hét lên, hét lên, la hét |
| 😪 | Buồn ngủ, uể oải/ uể oải |
| 😴 | Ngủ nói, ngáy |
| ⏩ | Nói nhanh, nói nhanh, vội vàng |
| 📞 | Qua điện thoại, qua loa |
| 🐢 | Chậm |
| 🥤 | Nuốt, nuốt âm thanh |
| 🤧 | Ho, sụt sịt, hắt hơi, hắng giọng |
| 😒 | Tít, tặc lưỡi |
| 😰 | Hoảng sợ, kích động, lo lắng, lắp bắp |
| 😆 | Vui vẻ, hạnh phúc |
| 💥 | Với lực/động lượng, một cách mạnh mẽ |
| 😠 | Tức giận, khó chịu, hờn dỗi |
| 😲 | Sự ngạc nhiên, kinh ngạc/cảm thán |
| 🥱 | Ngáp |
| 😖 | Một cách đau đớn, một cách đau đớn |
| 😟 | Một cách lo lắng, một cách lo lắng |
| 🫣 | Ngượng ngùng, ngượng ngùng |
| 🙄 | Phấn khích trợn tròn mắt |
| 😊 | Vui vẻ, hân hoan |
| 😎 | Tự tin, kiêu hãnh |
| 👌 | Kênh ngược, âm thanh của sự đồng ý |
| 🙏 | Van xin, cầu xin |
| 🥴 | say rượu |
| 🎵 | ngân nga |
| 🤐 | Bịt miệng (bịt miệng) |
| 😌 | Nhẹ nhõm, hài lòng |
| 🤔 | Giọng hỏi thăm, băn khoăn |
| 💪 | Với sự nỗ lực, mạnh mẽ |
| 👃 | Âm thanh đánh hơi/ngửi mùi |
| 📖 | Tường thuật, độc thoại |

Việc lặp đi lặp lại cùng một biểu tượng cảm xúc có thể tăng cường tác dụng của nó. Kiểm soát biểu tượng cảm xúc không hoàn toàn nhất quán, vì vậy hãy coi chúng như tín hiệu phong cách thay vì đầu ra được đảm bảo. Xem [chú thích biểu tượng cảm xúc IrodoriTTS chính thức](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) để biết danh sách cập nhật và các bản cập nhật trong tương lai.

## Tin nhắn thoại dài

Irodori v4.1 dự đoán độ dài đầu ra bằng bộ dự đoán thời lượng thay vì tạo clip có độ dài cố định, do đó máy chủ không áp đặt giới hạn thời lượng cho mỗi lần phát âm. TomoriBot vẫn phân đoạn văn bản dài trước khi tổng hợp và ghép âm thanh được tạo thành một phản hồi WAV, do đó Discord nhận được một tin nhắn thoại; việc phân đoạn giữ cho mỗi lần suy luận được truyền ngắn, đó là giới hạn độ trễ.

Quá trình triển khai bắt đầu từ phương pháp phân nhóm được sử dụng bởi [máy chủ tương thích Irodori OpenAI chính thức](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py), có mặc định cho phép phân chia ở 80 ký tự không phải khoảng trắng. TomoriBot bổ sung khả năng xử lý ranh giới chặt chẽ hơn để dấu ngoặc kép và dấu ngoặc đóng vẫn giữ nguyên dấu câu mà chúng đóng, các dấu câu như `！？` và `...` ở cùng nhau, dấu thập phân bên cạnh các chữ số không bị phân tách và các đuôi cuối cùng rất ngắn được hợp nhất trở lại đoạn trước đó.

Chunking ưu tiên các kết thúc câu mạnh mẽ như `。`, `！`, `？`, `.`, `!`, `?`, dấu chấm lửng và ngắt dòng khi đạt đến độ dài tối thiểu được định cấu hình. Dấu phẩy chỉ được sử dụng làm ranh giới dự phòng sau khi đoạn này tăng lên khoảng 1,5 lần ngưỡng đó. Với `IRODORI_CHUNK_MIN_CHARS=80` mặc định, các ranh giới mạnh trở nên đủ điều kiện ở 80 ký tự không phải khoảng trắng và dấu phẩy ở khoảng 120. Nếu một đoạn văn dài không chứa dấu câu đủ điều kiện thì nó vẫn có thể vẫn là một yêu cầu tổng hợp duy nhất.

Đối với VoiceDesign chỉ có chú thích, hạt giống Irodori được tạo của đoạn đầu tiên sẽ được sử dụng lại cho các đoạn còn lại để giảm sự biến đổi ngẫu nhiên giữa các đường nối. Việc sử dụng lại hạt giống không đảm bảo âm sắc giống hệt nhau trên các đoạn được tổng hợp độc lập. Chế độ âm thanh tham chiếu tiếp tục áp dụng cùng một clip tham chiếu cho từng đoạn.

Đầu vào dài yêu cầu nhiều lần suy luận tuần tự và có thể mất nhiều thời gian hơn trên phần cứng chậm hơn. Thời gian chờ máy khách TTS mặc định của TomoriBot là 240 giây. Bạn có thể tắt tính năng phân đoạn bằng `IRODORI_CHUNKING_ENABLED=false` hoặc điều chỉnh ngưỡng phân chia gần đúng bằng `IRODORI_CHUNK_MIN_CHARS`.

## Suy luận nhanh hơn với lấy mẫu lắc lư

Mặc định vẫn là lấy mẫu tuyến tính 40 bước chất lượng cao hơn của Irodori. Để có độ trễ thấp hơn, hãy thử Lấy mẫu Sway với ít bước hơn:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Đây là sự cân bằng giữa chất lượng suy luận và tốc độ, vì vậy hãy kiểm tra nó bằng điểm kiểm tra và giọng nói đã chọn của bạn trước khi biến nó thành vĩnh viễn.

## Biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Kho lưu trữ model Ôm khuôn mặt hoặc nguồn kho lưu trữ/thư mục con được hỗ trợ |
| `IRODORI_TTS_CHECKPOINT` | bỏ đặt | Điểm kiểm tra `.pt` hoặc `.safetensors` cục bộ tùy chọn; ghi đè model Ôm Mặt |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết máy chủ; xem [Truy cập mạng](/vi/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Cổng máy chủ |
| `IRODORI_MODEL_DEVICE` | `auto` | Thiết bị mẫu (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Thiết bị giải mã |
| `IRODORI_MODEL_PRECISION` | `bf16` trên CUDA, nếu không thì `fp32` | Độ chính xác của model |
| `IRODORI_CODEC_PRECISION` | `fp32` | Độ chính xác của mã hóa |
| `IRODORI_COMPILE_MODEL` | `false` | Kích hoạt `torch.compile` cho mẫu Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Bật hình dạng động khi biên dịch |
| `IRODORI_NUM_STEPS` | `40` | Các bước lấy mẫu Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Lịch lấy mẫu (`linear` hoặc `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Hệ số lắc khi sử dụng lịch trình `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Thang đo hướng dẫn văn bản |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Thang hướng dẫn Caption/VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Thang hướng dẫn của người nói tham khảo |
| `IRODORI_MAX_REF_SECONDS` | điểm kiểm tra mặc định | Giới hạn tùy chọn về thời lượng âm thanh tham chiếu |
| `IRODORI_CHUNKING_ENABLED` | `true` | Tách văn bản dài ở ranh giới dấu câu đủ điều kiện và nối các đoạn được tạo |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Ký tự không phải khoảng trắng tối thiểu trước khi phân chia ranh giới câu mạnh mẽ; dấu phẩy là ranh giới dự phòng ở khoảng 1,5 lần giá trị này |
