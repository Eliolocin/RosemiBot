---
title: "CosyVoice 3"
aiGenerated: true
---

Tổng hợp giọng nói tự nhiên, đa ngôn ngữ của nhân vật với khả năng truyền tải cảm xúc dựa trên hướng dẫn bằng cách sử dụng [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) của Alibaba.

CosyVoice 3 cung cấp tính năng sao chép giọng nói đa ngôn ngữ và không cần ghi âm trên 9 ngôn ngữ và hơn 18 phương ngữ tiếng Trung. TomoriBot kết thúc thời gian chạy chính thức trong `servers/tts/cosyvoice3/` để hiển thị giao diện giọng nói `POST /synthesize` tiêu chuẩn. Trình cài đặt đi kèm mặc định là mẫu `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` không được lượng tử hóa chính thức, chạy trong 16 GB VRAM.

## Các tính năng hỗ trợ

Bản phát hành CosyVoice 3 hiện tại hỗ trợ:

- Tiếng Trung, tiếng Anh, tiếng Nhật, tiếng Hàn, tiếng Đức, tiếng Tây Ban Nha, tiếng Pháp, tiếng Ý và tiếng Nga
- 18+ phương ngữ và giọng Trung Quốc
- nhân bản giọng nói zero-shot
- nhân bản giọng nói đa ngôn ngữ và đa ngôn ngữ
- hướng dẫn ngôn ngữ tự nhiên về ngôn ngữ, phương ngữ, cảm xúc, tốc độ nói và âm lượng
- các điều khiển chi tiết trong thời gian chạy ngược dòng, bao gồm `[breath]` và `[laughter]`
- truyền phát văn bản và âm thanh trong thời gian chạy ngược dòng

Các ví dụ CosyVoice 3 chính thức bao gồm một cảnh báo bằng tiếng Nhật: Văn bản tiếng Nhật được hiển thị sau khi chuyển đổi sang katakana. Tiếng Nhật là ngôn ngữ được hỗ trợ, nhưng nếu cách viết chính tả thông thường của tiếng Nhật tạo ra cách phát âm kém thì việc chuyển đổi văn bản tổng hợp sang katakana là giải pháp thay thế ngược dòng được khuyến nghị.

## Cách TomoriBot ánh xạ các yêu cầu

Trình bao bọc chấp nhận các trường `tts-clone` tiêu chuẩn:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

Nó định tuyến các yêu cầu tới CosyVoice 3 hàm suy luận như sau:

| Lời yêu cầu | Đường dẫn CosyVoice 3 |
|---|---|
| Âm thanh tham khảo + bản ghi | `inference_zero_shot` |
| Âm thanh tham chiếu không có bản ghi | `inference_cross_lingual` |
| `instruct` hoặc `language` rõ ràng | `inference_instruct2` |

Để có chất lượng sao chép tốt nhất, hãy cung cấp cả âm thanh tham chiếu và bản ghi phù hợp. Hướng dẫn hiện tại của CosyVoice 3 API điều kiện trên âm thanh tham chiếu mà không chấp nhận bản ghi tham chiếu, do đó các yêu cầu chứa `instruct` sẽ chuyển sang đường dẫn `inference_instruct2` chính thức.

### Điều khiển phong cách và cảm xúc

Đăng ký điểm cuối với đánh dấu `Thuần văn bản`. Hướng phân phối thuộc trường `voice_instructions` toàn cầu của điểm cuối. Tránh sử dụng các thẻ ngoặc vuông nội tuyến tùy ý vì chúng có nguy cơ gây ra các hướng dẫn mâu thuẫn, chẳng hạn như `[happy] Hello. [sad] Goodbye.`. Các thẻ `[breath]` và `[laughter]` gốc được hoãn lại cho đến khi TomoriBot hỗ trợ phát hiện thẻ dành riêng cho công cụ.

Trường `/synthesize` `instruct` được chuyển vào điều hòa lệnh của CosyVoice 3. Ví dụ bao gồm `sound relieved but still tired`, `speak as quickly as possible` hoặc `speak quietly with restrained excitement`.

## Streaming

CosyVoice 3 hỗ trợ truyền phát hai chiều ngược dòng. Điểm chuẩn ngược dòng báo cáo tính năng truyền phát văn bản vào và ra với độ trễ âm thanh ban đầu khoảng 150 mili giây trong các thiết lập được tối ưu hóa.

Giao diện giọng nói của TomoriBot yêu cầu một phản hồi âm thanh hoàn chỉnh duy nhất cho tin nhắn thoại Discord, do đó, trình bao bọc trả về một tệp WAV hoàn chỉnh và mặc định suy luận ngược dòng thành `stream=False`. Chỉ đặt `COSYVOICE3_UPSTREAM_STREAM=1` khi đo điểm chuẩn trực tiếp cho hành vi phát trực tuyến ngược dòng; nó không thay đổi độ trễ TomoriBot.

## Phần cứng

Phần cứng được đề xuất:

- GPU NVIDIA với 16 GB VRAM
- Python 3.10
- Trình điều khiển NVIDIA tương thích với CUDA 12
- `git`
- `ffmpeg` để chuẩn hóa mẫu giọng nói
- `sox` và `libsox-dev` trên Linux nếu xảy ra sự cố tương thích âm thanh

Model tham số 0,5B dễ dàng phù hợp với VRAM 16 GB mà không cần lượng tử hóa. Bản tải xuống điểm kiểm tra bao gồm các model luồng, mã thông báo giọng nói, model văn bản và trọng số học tăng cường, yêu cầu khoảng 10 GB dung lượng ổ đĩa cộng với các phần phụ thuộc Python.

Mặc dù khả năng suy luận của CPU được hỗ trợ về mặt kỹ thuật ngược dòng nhưng tốc độ này lại quá chậm đối với các tương tác bằng giọng nói của Discord.

## Cài đặt

### Linux và WSL2 (được khuyến nghị)

Từ kho lưu trữ gốc TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Hoặc khởi động máy chủ được định cấu hình và TomoriBot cùng nhau:

```bash
bun run launch --cosyvoice3
```

Trình cài đặt:

1. kiểm tra `QwenAudio/CosyVoice` cam kết `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` đệ quy vào `servers/tts/cosyvoice3/CosyVoice/`;
2. tạo `servers/tts/cosyvoice3/.venv`;
3. cài đặt các yêu cầu CosyVoice ngược dòng và các phần phụ thuộc của trình bao bọc; Và
4. tải xuống `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` tại Ôm mặt sửa đổi `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` thành `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

Việc chạy lại tập lệnh sẽ duy trì các bản sửa đổi được ghim này. Trình cài đặt từ chối ghi đè các lần kiểm tra bằng các thay đổi cục bộ không được cam kết.

Yêu cầu ngược lại cài đặt PyTorch 2.3.1 với các gói CUDA 12.1, gói CUDA 12 ONNX Runtime trên Linux và gói TensorRT 10.13 trên Linux. Nếu GPU của bạn yêu cầu bản dựng PyTorch mới hơn, hãy cài đặt bản dựng PyTorch tương thích bên trong môi trường ảo sau khi quá trình thiết lập hoàn tất.

### Windows PowerShell

Windows gốc được cung cấp dưới dạng đường dẫn nỗ lực tốt nhất:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

WSL2 được khuyến khích sử dụng GPU NVIDIA trên Windows. Yêu cầu ngược dòng cài đặt ONNX Runtime chỉ dành cho CPU trên Windows, trong khi Linux và WSL2 cài đặt các gói tăng tốc GPU.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và định cấu hình endpoint giọng nói:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Chế độ nguồn giọng đọc: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Sau khi lưu kết nối, hãy chọn kết nối đó và thêm một model Speech. Mã model rõ ràng là `Fun-CosyVoice3-0.5B-2512`.

Sau đó mở `/config` > Models > Switch Models và kích hoạt endpoint giọng nói CosyVoice 3.

## Gán giọng nói persona

Để sao chép giọng nói zero-shot:

1. Chuẩn bị một đoạn âm thanh rõ ràng dài từ 3 đến 30 giây bằng một loa và giảm thiểu tiếng ồn xung quanh.
2. Mở `/config` trong Models > `Tham số & Giọng đọc TTS` và tải mẫu lên.
3. Nhập bản ghi phù hợp nếu có. CosyVoice 3 mã hóa bản ghi này dưới dạng tiền tố nhắc nhở để nhân bản không bắn; nó sẽ mô tả 30 giây đầu tiên của âm thanh.
4. Mở `/config` trong Persona > `Giọng nói` và gán mẫu cho cá nhân đó.

CosyVoice thực thi cửa sổ nhắc 30 giây. Trong khi công cụ ngược dòng phát sinh lỗi khi âm thanh vượt quá 30 giây, trình bao bọc của TomoriBot sẽ tự động cắt các clip về 30 giây đầu tiên và ghi nhật ký phần cắt vào bảng điều khiển.

Phần nhúng của người nói và mã thông báo lời nhắc được tính từ 30 giây mở đầu, vì vậy các clip dài hơn 30 giây sẽ không thêm chi tiết giọng nói. Sử dụng một clip sạch trong khoảng từ 10 đến 20 giây sẽ đảm bảo căn chỉnh nhanh chóng và chính xác.

Hỗ trợ nhân bản đa ngôn ngữ: người nói tham chiếu có thể nói một ngôn ngữ khác với văn bản được tạo. Nếu không có bản ghi tham chiếu nào được cung cấp, trình bao bọc sẽ định tuyến yêu cầu tới đường dẫn công cụ đa ngôn ngữ chuyên dụng của CosyVoice 3.

## Thử nghiệm với `/generate voice-message`

Sử dụng `/generate voice-message` để kiểm tra tổng hợp mà không cần chờ kích hoạt trò chuyện tự động. Bạn có thể kiểm tra bằng mẫu được chỉ định của persona đó hoặc tải lên một đoạn clip duy nhất kèm theo bản ghi của persona đó.

Để hướng dẫn cảm xúc và cách truyền tải, hãy nhập hướng theo phương thức hoặc để lời nhắc của persona cung cấp `voice_instructions`. Giữ văn bản nói như một cuộc đối thoại đơn giản; thẻ kiểu nội tuyến được loại bỏ trước khi tổng hợp.

## Biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Thư mục điểm kiểm tra địa phương |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết của trình bao bọc; xem [Truy cập mạng](/vi/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Cổng gói |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Kích hoạt trình tạo phát trực tuyến nội bộ của CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Hệ số nhân tốc độ số toàn cầu được chuyển đến suy luận ngược dòng |
| `COSYVOICE3_DEFAULT_INSTRUCT` | trống | Hướng dẫn tùy chọn được thêm vào khi yêu cầu không cung cấp |
| `COSYVOICE3_FP16` | `0` | Yêu cầu thời gian chạy chính thức sử dụng chế độ fp16 của nó |
| `COSYVOICE3_LOAD_TRT` | `0` | Cho phép tải TensorRT ngược dòng khi được chuẩn bị đúng cách |
| `COSYVOICE3_LOAD_VLLM` | `0` | Cho phép tải vLLM ngược dòng khi cài đặt các phần phụ thuộc riêng biệt của nó |

Theo mặc định, TensorRT, vLLM và fp16 vẫn bị tắt. Thời gian chạy PyTorch tiêu chuẩn chạy thoải mái trên GPU 16 GB mà không cần phụ thuộc thêm vào thời gian chạy.

## Hiệu năng và các biến thể model

### Mặc định: `Fun-CosyVoice3-0.5B-2512` cơ sở

Đây là mặc định được đề xuất cho TomoriBot. Nó cung cấp độ tương tự loa cao, hỗ trợ tất cả các chế độ hướng dẫn và nhân bản CosyVoice 3, đồng thời không yêu cầu lượng tử hóa trên GPU 16 GB.

### Trọng lượng học tăng cường

Gói điểm kiểm tra bao gồm `llm.rl.pt` cùng với trọng lượng cơ bản. Trọng số RL làm giảm tỷ lệ lỗi nội dung, trong khi trọng số cơ bản đạt điểm cao hơn một chút trong các tiêu chuẩn về độ tương tự của loa. Vì độ trung thực của giọng nói cá nhân được ưu tiên nên trình bao bọc mặc định là `llm.pt`.

Trình tải ngược dòng mong đợi `llm.pt`. Để kiểm tra trọng số RL mà không sửa đổi các tệp mặc định, hãy sao chép thư mục model, đổi tên `llm.rl.pt` thành `llm.pt` bên trong bản sao và đặt `COSYVOICE3_MODEL_DIR` vào thư mục đã sao chép.

### vLLM và TensorRT

CosyVoice 3 hỗ trợ thời gian chạy vLLM và TensorRT tùy chọn. Các tài liệu ngược dòng vLLM 0.11.x+ với công cụ V1 và vLLM 0.9.0 là phiên bản kế thừa. Vì các thư viện này đưa ra các yêu cầu nghiêm ngặt về phiên bản phụ thuộc và CUDA nên TomoriBot không cài đặt chúng theo mặc định.

## Giấy phép

Cơ sở mã CosyVoice và trọng số `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` được xuất bản theo giấy phép Apache-2.0.

Thẻ model ngược dòng lưu ý rằng tài liệu trình diễn là để đánh giá học thuật. TomoriBot không phân phối trọng lượng model. Xem lại các điều khoản và cấp phép ngược dòng cho trường hợp sử dụng cụ thể của bạn trước khi triển khai thương mại.
