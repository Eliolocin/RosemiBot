---
title: "So sánh các engine TTS"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot hỗ trợ nhiều máy chủ Chuyển văn bản thành giọng nói (Text-to-Speech) cục bộ, mỗi máy chủ phù hợp với các ngôn ngữ, cấu hình phần cứng và yêu cầu độ trễ khác nhau.

Trang này cung cấp kết quả benchmark thực nghiệm, thời gian tổng hợp và các đoạn âm thanh so sánh được ghi lại trong môi trường thử nghiệm giống hệt nhau với các mẫu âm thanh tham chiếu sao chép giọng nói tương ứng.

## Sao chép giọng nói đa ngôn ngữ & tiếng Anh

### Prompt benchmark

- Prompt tiêu chuẩn *(sử dụng cho Chatterbox Standard/Turbo/Nano, MOSS-TTS, CosyVoice 3, VoxCPM2, Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- Prompt Fish Audio S2 Pro *(được thử nghiệm với các thẻ biểu cảm trong ngoặc vuông)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Hiệu năng & so sánh âm thanh

Thời gian đo lường báo cáo cả toàn bộ thời gian tạo (tổng số giây theo thời gian thực từ lúc yêu cầu đến khi âm thanh hoàn tất) và Real-Time Factor (RTF), được xác định là thời gian tạo chia cho thời lượng âm thanh:

- RTF < 1.0 (in đậm): Engine tạo giọng nói nhanh hơn thời gian thực (ví dụ, `0.50× RTF` kết xuất đoạn clip dài 10 giây trong 5 giây). Chỉ những engine này mới có thể theo kịp cuộc gọi thoại trực tiếp, tính năng mà TomoriBot hiện chưa triển khai.
- RTF > 1.0: Thời gian tạo lâu hơn thời lượng âm thanh được nói. TomoriBot gửi mỗi tin nhắn thoại dưới dạng một tệp hoàn chỉnh, vì vậy RTF cao hơn chỉ đồng nghĩa với việc phải chờ lâu hơn.

| Engine | Windows Native<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Mẫu âm thanh |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/vi/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8-10 phút<sup>(2)</sup><br/>*(~65× RTF)* | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox (Turbo, Mặc định)](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~5.0s *(clip 8.7s)*<br/>0.57× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox (Nano)](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~3.0s *(clip 8.0s)*<br/>0.38× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox (Tiêu chuẩn)](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~6.0s *(clip 7.8s)*<br/>0.77× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/vi/self-hosting/local-endpoints/text-to-speech/moss/) | ~12.0s *(clip 8.8s)*<br/>1.36× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/vi/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | ~6.0s *(clip 13.9s)*<br/>0.43× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/vi/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | ~8.0s *(clip 7.4s)*<br/>1.09× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/vi/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | ~10.0s *(clip 9.2s)*<br/>1.09× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> Môi trường thử nghiệm: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) trên Windows 11 (thực thi gốc) sử dụng mẫu âm thanh tham chiếu đơn kênh (mono) 24 kHz dài 26,6 giây với bản phiên âm khớp từng từ.
- <sup>(2)</sup> Fish Audio S2 Pro: Quá trình thực thi trên Windows chạy ở chế độ eager mode chưa biên dịch (~65× RTF) do độ trễ khởi chạy CUDA kernel qua 76 lượt đánh giá lớp trên mỗi token. Bạn nên chạy trên Linux hoặc WSL2 với kỹ thuật kết hợp trình biên dịch OpenAI Triton (`torch.compile`) để tránh tình trạng nghẽn điều phối này.

---

## Sao chép giọng nói tiếng Nhật

### Prompt benchmark tiếng Nhật

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Hiệu năng tiếng Nhật & so sánh âm thanh

| Engine | Windows Native<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Mẫu âm thanh |
|---|---|---|---|---|
| [IrodoriTTS](/vi/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~4.0s *(clip 8.5s)*<br/>0.47× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Được đo lường trong cùng môi trường thử nghiệm RTX 4070 Ti SUPER Windows 11.

---

## Bạn nên chọn engine nào?

- Chọn [Fish Audio S2 Pro](/vi/self-hosting/local-endpoints/text-to-speech/fishs2/) nếu bạn muốn độ trung thực của giọng nói cao nhất có thể, các thẻ biểu cảm chi tiết trong ngoặc vuông (`[whisper]`, `[laughs]`, `[sigh]`), và bạn có quyền truy cập vào Linux hoặc WSL2 nơi có thể bật kỹ thuật kết hợp trình biên dịch Triton.
- Chọn [Chatterbox (Turbo / Nano / Tiêu chuẩn)](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/) để sao chép giọng nói tiếng Anh với mức chiếm dụng VRAM nhỏ. Nano (~3.0s, 0.38× RTF) cung cấp tốc độ tối đa trên CPU/GPU, Turbo (~5.0s, 0.57× RTF) hỗ trợ các thẻ sự kiện cận ngôn ngữ (`[laughter]`, `[sigh]`), và Tiêu chuẩn (~6.0s, 0.77× RTF) cho phép hướng dẫn sáng tạo với CFG cùng tinh chỉnh độ phóng đại cảm xúc.
- Chọn [MOSS-TTS](/vi/self-hosting/local-endpoints/text-to-speech/moss/) để thử nghiệm sao chép giọng nói đa phương thức và tạo giọng nói tiếng Anh/tiếng Trung qua mô tả văn bản.
- Chọn [CosyVoice 3](/vi/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) nếu bạn cần sao chép zero-shot đa ngôn ngữ chất lượng cao với chỉ dẫn truyền đạt bằng ngôn ngữ tự nhiên (`"Speak in English with excitement"`).
- Chọn [VoxCPM2](/vi/self-hosting/local-endpoints/text-to-speech/voxcpm2/) nếu bạn cần hỗ trợ đa ngôn ngữ toàn diện (30 ngôn ngữ), Ultimate Cloning có hỗ trợ của bản phiên âm, và thiết kế giọng nói tự nhiên.
- Chọn [Qwen3-TTS](/vi/self-hosting/local-endpoints/text-to-speech/qwen3tts/) nếu bạn muốn sao chép đa ngôn ngữ rõ ràng với khả năng thiết kế giọng nói linh hoạt và mức độ bám sát prompt ổn định.
- Chọn [IrodoriTTS](/vi/self-hosting/local-endpoints/text-to-speech/irodoritts/) nếu bot của bạn nói tiếng Nhật. Đây là engine thuần tiếng Nhật duy nhất được đo lường (~4s, 0.47× RTF trên Windows) và phân tích cú pháp Unicode emoji gốc (`😊`, `😭`, `😠`) để điều chỉnh cảm xúc của nhân vật.

---

## So sánh các engine

Tất cả các máy chủ TTS của TomoriBot hiện đều trả về một tệp WAV hoàn chỉnh cho bot. "Đường dẫn streaming" có nghĩa là model thượng nguồn hoặc backend cung cấp riêng biệt có hỗ trợ tính năng này; điều này không có nghĩa là tính năng phát trực tiếp trong kênh thoại Discord đã được triển khai. Kích thước ở đây là số lượng tham số của model, không phải dung lượng VRAM hoặc dung lượng tải về, và cột 16 GB GPU là hướng dẫn thiết lập thay vì mức đỉnh được đo lường. Cột tốc độ mô tả sự đánh đổi dự định của từng engine; các mốc thời gian đo được ở trên đến từ một máy chạy Windows và không phản ánh thứ hạng của các engine trên Linux.

Cột "Clip tham chiếu" cho biết độ dài âm thanh tham chiếu mà mỗi engine ghi lại trong tài liệu hoặc áp dụng trong runtime, vì vậy cột này pha trộn hướng dẫn đã công bố với các giới hạn đọc được từ mã nguồn thượng nguồn. Hầu hết các engine cắt âm thầm theo cửa sổ của mình thay vì từ chối yêu cầu, đó là lý do cột này nêu những gì engine đọc chứ không chỉ những gì engine chấp nhận. Đây là hành vi ở thượng nguồn, không phải kết quả đo tại đây, và độc lập với giới hạn tải lên của TomoriBot.

| Engine | Kích thước model; 16 GB GPU | Ngôn ngữ | Clip tham chiếu | Nguồn giọng nói và khả năng kiểm soát | Tốc độ / đường dẫn streaming | Chọn engine này cho |
|---|---|---|---|---|---|---|
| [Chatterbox](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo (mặc định), 110M Nano, hoặc 500M Tiêu chuẩn; có, Nano có thể dùng CPU | Tiếng Anh | 10 giây; phần dài hơn bị bỏ qua âm thầm khi vượt quá cửa sổ 10 giây của prompt | Sao chép từ tham chiếu, các thẻ sự kiện được hỗ trợ; model tiêu chuẩn cung cấp CFG/độ phóng đại | Tập trung nhanh/gọn; wrapper trả về tệp WAV đầy đủ | Thiết lập sao chép tiếng Anh gọn nhẹ hoặc thử nghiệm trên CPU |
| [Qwen3-TTS](/vi/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 1.7B cho mỗi chế độ; có, các model hoán đổi cho nhau | 10 ngôn ngữ, bao gồm tiếng Anh/tiếng Nhật | Từ 3 giây; không có giới hạn được ghi lại | Sao chép hoặc VoiceDesign qua mô tả văn bản | Tập trung vào chất lượng; streaming ở thượng nguồn, wrapper lưu vào bộ đệm | Sao chép đa ngôn ngữ đa dụng và VoiceDesign tiếng Nhật |
| [MOSS-TTS](/vi/self-hosting/local-endpoints/text-to-speech/moss/) | 4B sao chép + ~1.7B thiết kế, được hoán đổi; 16 GB là mục tiêu thử nghiệm, chưa được xác minh; bản 8B đầu bảng có thể không vừa | Sao chép: 31 ngôn ngữ, bao gồm tiếng Nhật; thiết kế: tiếng Anh/tiếng Trung | Không được ghi lại ở thượng nguồn; không có giới hạn runtime | Sao chép hoặc VoiceGenerator qua mô tả văn bản; thẻ ngôn ngữ sao chép | Thử nghiệm; Local clone có backend streaming thượng nguồn, wrapper lưu vào bộ đệm | So sánh chất lượng sao chép MOSS hoặc thiết kế giọng nói tiếng Anh/tiếng Trung |
| [IrodoriTTS](/vi/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~0.8B bản v4.1 Small hiện tại; quan sát thấy mức chiếm dụng ~3-4 GB VRAM trong một lần chạy cục bộ | Chỉ tiếng Nhật | ~30 giây; bị cắt theo giới hạn 120 s của checkpoint | Sao chép hoặc VoiceDesign; gợi ý phong cách qua emoji | Các bước lấy mẫu đánh đổi chất lượng lấy tốc độ; wrapper lưu vào bộ đệm | Giọng tiếng Nhật chiếm ít tài nguyên và cách truyền đạt điều khiển bằng emoji |
| [Fish S2 Pro](/vi/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B; mặc định BF16 chính thức (~16-18 GB), tùy chọn INT8 cho 16 GB | 83 ngôn ngữ theo công bố thượng nguồn | 10-30 giây; không có giới hạn runtime | Sao chép từ tham chiếu (yêu cầu bản phiên âm tham chiếu), các thẻ biểu cảm trong ngoặc vuông tự do | Model Dual-AR nặng; yêu cầu Linux/WSL2 với Triton để tổng hợp nhanh (~65× RTF trên Windows ở chế độ eager) | Sao chép biểu cảm chi tiết; hãy kiểm tra các điều khoản giấy phép nghiên cứu |
| [VoxCPM2](/vi/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B; ~8 GB BF16 theo báo cáo thượng nguồn | 30 | 5-30 giây; khoảng được ghi lại, không có giới hạn runtime | Sao chép, Voice Design, Ultimate Cloning có hỗ trợ của bản phiên âm, chỉ dẫn truyền đạt | ~0.30 RTF trên RTX 4090 thượng nguồn; streaming ở thượng nguồn, wrapper lưu vào bộ đệm | Một model đa ngôn ngữ với các điều khiển nguồn giọng nói rộng nhất |
| [CosyVoice 3](/vi/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 0.5B phần lõi; 16 GB thoải mái, gói tải về/runtime lớn hơn | 9 ngôn ngữ, bao gồm tiếng Nhật, cùng các phương ngữ tiếng Trung | 3-30 giây; đoạn dài hơn được cắt về 30 giây đầu tiên | Sao chép, sao chép chéo ngôn ngữ, truyền đạt bằng ngôn ngữ tự nhiên | Tập trung vào độ trễ thấp; streaming văn bản/âm thanh gốc ở thượng nguồn, wrapper lưu vào bộ đệm | Một ứng viên streaming trong tương lai với khả năng sao chép chéo ngôn ngữ |

Kích thước model và số lượng ngôn ngữ tuân theo các trang thượng nguồn của [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2), và [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512). Hãy kiểm tra từng hướng dẫn để biết chi tiết về hệ điều hành, driver, giấy phép, phiên bản sửa đổi của model, và bộ nhớ. Một GPU 16 GB không nhất thiết có thể lưu trữ đồng thời cả model TTS và LLM cục bộ lớn.

Số liệu VRAM của Irodori là một quan sát cục bộ đơn lẻ, không phải là mức tối thiểu được công bố hay benchmark so sánh giữa các engine. Mức sử dụng bộ nhớ thay đổi tùy theo runtime, độ chính xác, độ dài kịch bản và các tác vụ GPU khác.

Yêu cầu tự động đầu tiên của Qwen3-TTS bao gồm việc nạp model vào bộ nhớ. MOSS tải trước cả hai model trong quá trình cài đặt và làm ấm model sao chép khi khởi động theo mặc định, nhưng máy chủ tự động ở cả hai engine vẫn phải tải model còn lại sau khi chuyển đổi chế độ. TomoriBot đợi tối đa `TTS_SYNTHESIZE_TIMEOUT_MS` (mặc định 240000 ms) cho mỗi phản hồi hoàn chỉnh.
