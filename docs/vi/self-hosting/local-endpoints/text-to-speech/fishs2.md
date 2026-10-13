---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Tổng hợp lời nói của nhân vật đa ngôn ngữ, có tính biểu cảm cao với các thẻ cảm xúc chi tiết bằng [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

Fish Audio S2 Pro là model chuyển văn bản thành giọng nói tham số 4B đa ngôn ngữ được thiết kế để sao chép giọng nói có độ trung thực cao. TomoriBot kết nối với model thông qua trình bao bọc cục bộ trong `servers/tts/fishs2/`. Nó mặc định có trọng số BF16 chính thức (`fishaudio/s2-pro`), với điểm kiểm tra lượng tử hóa INT8 tùy chọn (`Imagilux/fishaudio-s2-pro`) dành cho GPU có 8 đến 12 GB VRAM.

Fish S2 Pro hỗ trợ các thẻ biểu thức ngoặc như `[whisper]`, `[excited]` và `[angry]`. Định cấu hình điểm cuối bằng đánh dấu `Thẻ trong ngoặc vuông` để TomoriBot duy trì các điều khiển này trong tập lệnh thoại được tạo.

## Giấy phép

Mã nguồn Fish Speech và trọng số model S2 Pro được phân phối theo Giấy phép Nghiên cứu Fish Audio (Fish Audio Research License). Việc nghiên cứu và sử dụng phi thương mại được cho phép theo các điều khoản của giấy phép; việc sử dụng thương mại yêu cầu phải có giấy phép Fish Audio riêng biệt.

TomoriBot không phân phối lại trọng số model. Mỗi người dùng self-hosting sẽ tải trực tiếp Fish S2 Pro từ Hugging Face và chịu trách nhiệm tuân thủ Giấy phép Nghiên cứu Fish Audio. Ghi nhận tác giả bắt buộc là: Built with Fish Audio.

## Phần cứng và hệ điều hành

> [!QUAN TRỌNG]
> Fish Audio chính thức nhắm tới Linux và WSL2. Fish S2 Pro sử dụng kiến trúc Tự động hồi quy kép (Dual-AR) (36 lớp biến áp chậm + 10 lượt chuyển sách mã nhanh = 76 lớp đánh giá cho mỗi mã thông báo). Trên Linux, OpenAI Triton biên dịch vòng lặp này thành các nhân GPU hợp nhất (`torch.compile(backend="inductor")`), cho phép tổng hợp theo thời gian thực. Trình bao bọc tắt quá trình biên dịch theo mặc định; đặt `FISH_S2_COMPILE=1` để kích hoạt nó. >
> Trên Windows gốc, Triton không được hỗ trợ, buộc PyTorch chuyển sang chế độ háo hức chưa được biên dịch với hơn 120.000 hạt nhân CUDA tuần tự gửi qua trình điều khiển WDDM của Windows. Điều này gây ra hiện tượng dừng truyền dữ liệu nghiêm trọng, làm chậm quá trình tạo xuống còn ~8-10 phút (~65 giây tính toán mỗi giây âm thanh) cho cùng một clip. Để có thể suy luận có thể sử dụng được, hãy chạy Fish S2 Pro bên trong Linux hoặc WSL2.

Phần cứng được đề xuất:

- **Linux hoặc WSL2 (Rất khuyến khích)**
- GPU NVIDIA có VRAM 16 GB đến 24 GB (BF16 vừa vặn thoải mái trong VRAM ~ 16-18 GB với bộ đệm và giảm tải KV)
- Đề xuất Python 3.12
- `git`, `ffmpeg` và các thư viện âm thanh tiêu chuẩn theo yêu cầu của Fish Speech

## Cài đặt

### Linux và WSL2 (được khuyến nghị)

Từ kho lưu trữ gốc TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

Trình cài đặt:

1. sao chép `Imagilux/fish-speech` vào `servers/tts/fishs2/fish-speech/` và kiểm tra cam kết thời gian chạy được ghim;
2. tạo `.venv` bị cô lập;
3. cài đặt Fish Speech cộng với các phụ thuộc của trình bao bọc TomoriBot; Và
4. tải điểm kiểm tra BF16 `fishaudio/s2-pro` chính thức vào `fish-speech/checkpoints/fish-speech-s2-pro/`.

Quá trình cài đặt lại bình thường vẫn nằm trên cam kết thời gian chạy được ghim `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` thay vì đi theo nhánh đang di chuyển; chuyển sang thời gian chạy mới hơn có nghĩa là thay đổi mã pin đó trong trình cài đặt. Bản sửa đổi model mặc định là `main`; ghim `FISH_S2_MODEL_REVISION` vào bản sửa đổi Khuôn mặt ôm bất biến khi quá trình triển khai phải được lặp lại. Cài đặt trình cài đặt được liệt kê trong [Biến trình cài đặt](#installer-variables).

Model Ôm Mặt được kiểm soát. Trước tiên hãy chấp nhận giấy phép của nó trên Ôm Mặt. Nếu quá trình tải xuống yêu cầu xác thực, hãy chạy:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Sau đó chạy lại trình cài đặt.

### Windows PowerShell (chỉ nỗ lực tốt nhất)

Windows gốc chỉ được cung cấp để đánh giá. Do độ trễ gửi trình điều khiển ở chế độ háo hức chưa được biên dịch nên quá trình tạo sẽ cực kỳ chậm (~8-10 phút mỗi clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

Trình cài đặt PowerShell nhắm mục tiêu tăng tốc GPU CUDA (`cu124`) theo mặc định. Để cài đặt trên máy chỉ có CPU không có GPU NVIDIA, hãy vượt qua `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Nếu PyTorch trên Windows cần được cài đặt hoặc cập nhật thủ công với sự hỗ trợ CUDA, hãy chạy:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot dừng chờ tin nhắn thoại sau `TTS_SYNTHESIZE_TIMEOUT_MS` (mặc định 240000 mili giây), ngắn hơn so với thời lượng của một đoạn clip gốc của Windows. Nâng nó lên trong `.env` của TomoriBot (ví dụ `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) trong khi đánh giá trên Windows.

## Bảng điểm tham khảo bắt buộc

> [!CẢNH BÁO]
> Cần có văn bản tham chiếu (`ref_text`) để sao chép giọng nói; Cơ chế chú ý chéo của Fish S2 Pro yêu cầu bản ghi âm thanh tham chiếu để căn chỉnh mã thông báo ngữ âm với mã âm thanh. >
> Nếu bạn tải mẫu giọng nói lên mà không cung cấp bản ghi tham chiếu phù hợp, Fish Speech sẽ âm thầm loại bỏ mã thông báo âm thanh tham chiếu và quay lại giọng nói không tham chiếu ngẫu nhiên. Trình bao bọc Cá TomoriBot xác thực và từ chối các yêu cầu tổng hợp thiếu văn bản tham chiếu với `400 Bad Request` để ngăn chặn việc vô tình tạo ra vô điều kiện.

Khi thêm giọng nói cá nhân trong `/config` trong trường `Models > `Tham số & Giọng đọc TTS``, always fill in the `Reference Transcript` với văn bản nguyên văn được nói trong clip âm thanh tham chiếu của bạn.

## Đăng ký trong TomoriBot

Trong `/providers`, chọn `Thêm endpoint tùy chỉnh mới` và cấu hình:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Chế độ nguồn giọng đọc: `Clone`
- Script Markup: `Thẻ trong ngoặc vuông`
- API key: để trống. Wrapper không có xác thực; xem [Truy cập mạng](/vi/self-hosting/local-endpoints/text-to-speech/#network-access).

Sau đó thêm mục model của endpoint và kích hoạt mục đó qua `/config` dưới phần Models > Switch Models.

## Thêm giọng nói persona

1. Chuẩn bị một đoạn clip tham chiếu rõ ràng dài 10-20 giây với một người nói và ít hoặc không có tiếng ồn nền.
2. Trong `/config`, mở Models > `Tham số & Giọng đọc TTS` và tải mẫu giọng nói lên.
3. Nhập chính xác bản phiên âm được nói trong đoạn clip tham chiếu vào trường văn bản tham chiếu.
4. Trong `/config`, mở Persona > Voice và gán mẫu cho persona.
5. Tạo tin nhắn thoại bằng `/generate voice-message` hoặc để TomoriBot tạo tin nhắn qua công cụ tin nhắn thoại của bot.

Thượng nguồn mô tả việc sao chép chính xác từ các mẫu tham chiếu thường dài 10-30 giây. Runtime của riêng Fish S2 Pro không áp đặt giới hạn thời lượng tham chiếu, vì vậy clip dài hơn vẫn được chấp nhận thay vì bị cắt bớt, nhưng chất lượng sao chép được tài liệu hóa đến từ khoảng 10-30 giây.

## Điều khiển biểu cảm

Fish S2 Pro có thể thay đổi cách truyền đạt trong cùng một câu nói bằng cách sử dụng các thẻ trong ngoặc vuông. Ví dụ:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Vì endpoint sử dụng markup `Thẻ trong ngoặc vuông`, TomoriBot sẽ giữ lại các thẻ này thay vì loại bỏ chúng trước khi tổng hợp.

## Cấu hình

| Biến | Mặc định | Mục đích |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Thư mục checkpoint S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Kho lưu trữ model và nhãn siêu dữ liệu trạng thái cho checkpoint đã cấu hình |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết của wrapper; xem [Truy cập mạng](/vi/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Cổng wrapper Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Cổng API Fish nội bộ |
| `FISH_S2_COMPILE` | `0` | Bật `torch.compile` của Fish Speech (yêu cầu Linux/WSL2 với Triton) |
| `FISH_S2_HALF` | `0` | Yêu cầu chế độ runtime FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Độ dài phân đoạn prompt lặp lại của Fish |
| `FISH_S2_TOP_P` | `0.8` | Top-p lấy mẫu |
| `FISH_S2_TEMPERATURE` | `0.8` | Nhiệt độ lấy mẫu |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Hình phạt lặp lại |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Số lượng token ngữ nghĩa tối đa được tạo trên mỗi yêu cầu |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Lưu bộ nhớ đệm giọng nói tham chiếu đã mã hóa trong runtime Fish |

### Biến bộ cài đặt

Được đọc bởi `install-fishs2.sh` và `install-fishs2.ps1`. Hãy ghi lại bất kỳ giá trị nào bạn ghi đè để việc triển khai có thể tái lập.

| Biến | Mặc định | Mục đích |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Kho lưu trữ Hugging Face cần tải về |
| `FISH_S2_MODEL_REVISION` | `main` | Bản sửa đổi Hugging Face cần tải về |

Âm thanh tham chiếu phải là một tệp PCM RIFF/WAVE không nén, không rỗng và tối đa 10 MB sau khi giải mã. Giới hạn này được kiểm tra trước khi suy luận để yêu cầu base64 quá lớn không tiêu tốn bộ nhớ không giới hạn, và chứa được khoảng 237 giây WAV mono 22,05 kHz mà TomoriBot gửi.

## Tùy chọn VRAM thấp (lượng tử hóa INT8)

Người dùng chạy trên GPU có VRAM bị hạn chế (ví dụ: 8-12 GB) không phù hợp với điểm kiểm tra BF16 chính thức có thể chọn tham gia model lượng tử hóa INT8 (`Imagilux/fishaudio-s2-pro`).

Để cài đặt và chạy điểm kiểm tra INT8:

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Khởi động `server.py` từ cùng một shell hoặc đặt ba biến giống nhau trước khi khởi chạy nó, để trình bao bọc tải thư mục INT8 thay vì mặc định BF16.

Điểm kiểm tra INT8 giảm trọng lượng máy biến áp từ ~10,3 GB xuống ~5,1 GB trong khi vẫn giữ các phần nhúng âm thanh và lớp codec trong BF16, vừa vặn bên trong tổng VRAM ~10 GB.
