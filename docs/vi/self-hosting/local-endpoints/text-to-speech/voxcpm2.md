---
title: "VoxCPM2"
aiGenerated: true
---

Tổng hợp giọng nói 48 kHz biểu cảm trên 30 ngôn ngữ bằng model chuyển văn bản thành giọng nói [VoxCPM2](https://github.com/OpenBMB/VoxCPM) của OpenBMB.

VoxCPM2 là model giọng nói đa ngôn ngữ tham số 2B hỗ trợ nhân bản giọng nói, Nhân bản cuối cùng được hỗ trợ bản ghi và Thiết kế giọng nói bằng ngôn ngữ tự nhiên. TomoriBot kết nối với thư viện Python `voxcpm` chính thức thông qua máy chủ trong `servers/tts/voxcpm2/`, chạy điểm kiểm tra `openbmb/VoxCPM2` BF16 không được lượng tử hóa chính thức một cách thoải mái trong vòng 16 GB VRAM.

## Giấy phép

Mã nguồn và trọng số model VoxCPM2 được phát hành theo Apache-2.0, bao gồm cả việc sử dụng thương mại tuân theo các điều khoản giấy phép. TomoriBot không phân phối lại các trọng số; trình cài đặt tải chúng từ kho lưu trữ Hugging Face chính thức.

Tài nguyên thượng nguồn chính thức:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 trên Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Tài liệu VoxCPM](https://voxcpm.readthedocs.io/)

## Các ngôn ngữ được hỗ trợ

VoxCPM2 chính thức hỗ trợ 30 ngôn ngữ mà không cần thẻ ngôn ngữ:

Tiếng Ả Rập, tiếng Miến Điện, tiếng Trung, tiếng Đan Mạch, tiếng Hà Lan, tiếng Anh, tiếng Phần Lan, tiếng Pháp, tiếng Đức, tiếng Hy Lạp, tiếng Do Thái, tiếng Hindi, tiếng Indonesia, tiếng Ý, tiếng Nhật, tiếng Khmer, tiếng Hàn, tiếng Lào, tiếng Mã Lai, tiếng Na Uy, tiếng Ba Lan, tiếng Bồ Đào Nha, tiếng Nga, tiếng Tây Ban Nha, tiếng Swahili, tiếng Thụy Điển, tiếng Tagalog, tiếng Thái, tiếng Thổ Nhĩ Kỳ, và tiếng Việt.

OpenBMB cũng tài liệu hóa một số phương ngữ tiếng Trung. TomoriBot vẫn có thể gửi trường `language` để tương thích với giao ước TTS chung, nhưng VoxCPM2 tự phát hiện ngôn ngữ từ văn bản tổng hợp và wrapper không bắt buộc thẻ ngôn ngữ.

## Các chế độ giọng nói

Một endpoint VoxCPM2 có thể xử lý tất cả các chế độ nguồn giọng nói hữu ích của TomoriBot:

| Yêu cầu TomoriBot | Hành vi VoxCPM2 |
|---|---|
| Chỉ `text` | Bị từ chối; hãy chọn mẫu tham chiếu hoặc prompt VoiceDesign |
| `text` + `instruct` | Voice Design từ mô tả bằng ngôn ngữ tự nhiên |
| `text` + `ref_audio` | Sao chép giọng nói từ âm thanh tham chiếu |
| `text` + `ref_audio` + `instruct` | Sao chép có thể kiểm soát: giữ nguyên danh tính người nói trong khi điều hướng cách truyền đạt |
| `text` + `ref_audio` + `ref_text` | Ultimate Cloning sử dụng âm thanh tham chiếu và bản phiên âm của nó |
| `text` + `ref_audio` + `ref_text` + `instruct` | Sao chép có thể kiểm soát; hướng dẫn dùng một lần được ưu tiên hơn và bản phiên âm không được gửi |

VoxCPM2 biểu thị Voice Design và kiểm soát phong cách bằng cách đặt mô tả bằng ngôn ngữ tự nhiên trong dấu ngoặc đơn trước văn bản cần tổng hợp. TomoriBot đã có sẵn trường `instruct` cho mục đích này, vì vậy wrapper sẽ tự động thực hiện chuyển đổi đó.

Sử dụng Script Markup Plain. VoxCPM2 không yêu cầu TomoriBot phải giữ lại các thẻ trong ngoặc vuông hoặc cú pháp điều khiển emoji, và không cần chế độ Script Markup mới nào.

## Phần cứng và runtime

Điểm khởi đầu được khuyến nghị:

- Python 3.10-3.12
- GPU NVIDIA với 8 GB VRAM trở lên cho runtime BF16 chính thức; 12-16 GB mang lại khoảng trống thoải mái
- Driver NVIDIA hiện tại và bản dựng PyTorch hỗ trợ CUDA để tăng tốc GPU
- CPU được hỗ trợ dưới dạng dự phòng nhưng chậm hơn đáng kể

Gói chính thức cũng cung cấp khả năng lựa chọn thiết bị CPU và Apple MPS. Đối với TomoriBot trên Windows, gói Python tiêu chuẩn có thể chạy gốc; không bắt buộc phải dùng WSL. Trình cài đặt Windows PowerShell cài đặt bản dựng PyTorch hỗ trợ CUDA (`cu124`) theo mặc định.

Để cài đặt rõ ràng trên máy chỉ có CPU, hãy truyền cờ `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Nếu bản cài đặt PyTorch trên Windows gốc của bạn cần cài đặt lại thủ công hoặc căn chỉnh lại driver, hãy cài đặt bản dựng PyTorch hỗ trợ CUDA trực tiếp vào môi trường ảo của máy chủ:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB báo cáo RTF khoảng 0.30 trên RTX 4090 với runtime tiêu chuẩn. Thượng nguồn cũng hỗ trợ tạo streaming và tài liệu hóa các tùy chọn phục vụ nhanh hơn là Nano-vLLM và vLLM-Omni. Giao ước `POST /synthesize` hiện tại của TomoriBot trả về một phản hồi WAV, do đó máy chủ này chủ ý lưu vào bộ đệm câu nói được tạo thay vì cung cấp giao thức streaming riêng biệt.

## Cài đặt

Máy chủ ghim gói `voxcpm` 2.0.3 ổn định hiện tại và tải `openbmb/VoxCPM2` vào bộ đệm Hugging Face thông thường.

### Linux và WSL Bash

Từ kho lưu trữ gốc TomoriBot:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

Từ kho lưu trữ gốc TomoriBot:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

Thiết lập đầu tiên tải xuống vài gigabyte trọng lượng model. Để cài đặt môi trường Python mà không cần tìm nạp trước model, hãy đặt `VOXCPM2_PREFETCH=0`; thư viện chính thức sau đó sẽ tải xuống điểm kiểm tra khi khởi động máy chủ đầu tiên.

Linux và WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Sau khi thiết lập, `bun run launch --voxcpm2` khởi động máy chủ cùng với TomoriBot. Điểm cuối mặc định là `http://127.0.0.1:8016`.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và định cấu hình endpoint Speech:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Chế độ nguồn giọng đọc: `Auto`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm một model Speech. Sau đó mở `/config` > Models > Switch Models và chọn model giọng nói VoxCPM2.

`Auto` được khuyến nghị vì cùng một máy chủ hỗ trợ cả sao chép bằng âm thanh tham chiếu và Voice Design. Bạn không cần các tiến trình VoxCPM2 riêng biệt cho hai chế độ.

## Sao chép giọng nói persona

Đối với persona cần sao chép một người nói hiện có:

1. Chuẩn bị một clip tham chiếu rõ ràng với một người nói và ít hoặc không có nhạc nền. Thượng nguồn coi 5 đến 30 giây là khoảng thực tế.
2. Mở `/config` dưới phần Models > `Tham số & Giọng đọc TTS` và tải clip lên.
3. Thêm bản phiên âm chính xác của clip tham chiếu khi có sẵn. VoxCPM2 sử dụng bản phiên âm này cho Ultimate Cloning và có thể tái tạo nhiều hơn nhịp điệu, cảm xúc và phong cách của bản tham chiếu.
4. Mở `/config` dưới phần Persona > Voice, chọn persona, và gán mẫu đã lưu.

Nếu không có bản phiên âm nào được lưu, VoxCPM2 vẫn thực hiện sao chép bằng âm thanh tham chiếu thông thường.

Con số 5 đến 30 giây là một khoảng chất lượng đã được tài liệu hóa, chứ không phải một giới hạn được áp đặt: VoxCPM2 không áp dụng giới hạn thời lượng tham chiếu nào của riêng nó, vì vậy giới hạn tải lên của TomoriBot mới là thứ chặn một clip dài hơn.

## Thiết kế giọng nói Persona

Đối với persona cần được tạo từ mô tả giọng nói bằng văn bản thay vì mẫu:

1. Mở `/config` trong Persona > `Giọng nói` và chọn VoiceDesign.
2. Chọn persona.
3. Nhập mô tả bằng ngôn ngữ tự nhiên, chẳng hạn như `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

TomoriBot gửi mô tả đã lưu dưới dạng `instruct`. VoxCPM2 chuyển đổi nó thành tiền tố điều khiển Thiết kế giọng nói gốc.

Khi một persona nhân bản cũng nhận được hướng dẫn bằng giọng nói một lần, VoxCPM2 sử dụng nhân bản có thể kiểm soát: mẫu tham chiếu cung cấp danh tính người nói trong khi hướng dẫn điều khiển các phẩm chất như cảm xúc, tốc độ hoặc cách truyền tải. Nếu bản ghi cũng được lưu trữ, lệnh sẽ được ưu tiên vì đường dẫn Nhân bản cuối cùng ngược dòng không cung cấp chế độ hướng dẫn điều khiển đáng tin cậy; bản ghi được cố tình bỏ qua cho yêu cầu đó.

## Thử nghiệm với `/generate voice-message`

Khi VoxCPM2 là model Lời nói đang hoạt động, `/generate voice-message` sẽ sử dụng nguồn giọng nói được định cấu hình của người đó giống như các cuộc gọi công cụ tin nhắn thoại thông thường:

- nhân bản nhân bản gửi `ref_audio` được lưu trữ và `ref_text` tùy chọn;
- Nhân vật VoiceDesign gửi lời nhắc đã lưu của họ dưới dạng `instruct`;
- các điểm cuối có khả năng sao chép có bật Hướng dẫn hỗ trợ sẽ hiển thị trường Hướng dẫn phân phối và chuyển hướng dẫn một lần qua `instruct`;
- khi có lệnh xuất hiện cùng với mẫu bản sao, TomoriBot chỉ sử dụng `reference_wav_path` và không gửi các trường nhắc bảng điểm.

## Biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID model Hugging Face hoặc thư mục model cục bộ |
| `VOXCPM2_DEVICE` | `auto` | Thiết bị runtime: `auto`, `cuda`, `cuda:N`, `cpu`, hoặc `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Bật đường dẫn tối ưu hóa / biên dịch của runtime chính thức |
| `VOXCPM2_LOAD_DENOISER` | `0` | Tải bộ khử nhiễu thượng nguồn tùy chọn; bị tắt theo mặc định để tiết kiệm bộ nhớ |
| `VOXCPM2_CFG_VALUE` | `2.0` | Cường độ hướng dẫn |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Các bước suy luận flow-matching; nhiều bước hơn có thể cải thiện chất lượng nhưng giảm tốc độ |
| `VOXCPM2_MAX_LEN` | `4096` | Độ dài tạo tối đa |
| `VOXCPM2_NORMALIZE` | `0` | Bật chuẩn hóa văn bản thượng nguồn |
| `VOXCPM2_RETRY_BADCASE` | `1` | Bật hành vi thử lại ở thượng nguồn cho các trường hợp tạo bất thường |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Số lần tự động thử lại tối đa |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Ngưỡng độ dài trường hợp bất thường ở thượng nguồn |
| `VOXCPM2_PREFETCH` | `1` | Chỉ dành cho trình cài đặt: tải xuống model trong quá trình thiết lập |
| `VOXCPM2_PORT` | `8016` | Cổng máy chủ cục bộ VoxCPM2 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết máy chủ cục bộ; xem [Truy cập mạng](/vi/self-hosting/local-endpoints/text-to-speech/#network-access) |

Âm thanh tham chiếu phải là một container WAV không rỗng, tối đa 10 MB sau khi giải mã; wrapper kiểm tra điều này trước khi ghi tệp tạm thời.

## Các checkpoint và runtime thay thế

Model BF16 chính thức đã vừa vặn với mục tiêu GPU 16 GB tiêu dùng dự kiến, vì vậy TomoriBot không mặc định dùng checkpoint lượng tử hóa. Các bản lượng tử hóa cộng đồng có tồn tại, nhưng chúng thêm một lớp tương thích và bảo trì khác mà không cần thiết cho thiết lập thông thường.

Đối với các triển khai thông lượng cao, OpenBMB hiện trỏ đến Nano-vLLM-VoxCPM và vLLM-Omni làm các tùy chọn phục vụ tăng tốc. Những runtime đó có thể cung cấp các tính năng streaming và phục vụ đồng thời vượt ra ngoài máy chủ tham chiếu này. Chúng không bắt buộc cho quy trình làm việc tin nhắn thoại cục bộ thông thường của TomoriBot, và wrapper này chủ ý tuân thủ API `voxcpm` chính thức để việc nâng cấp model thượng nguồn luôn dễ theo dõi.
