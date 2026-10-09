---
title: "Giọng nói: TTS & STT"
sidebar:
  order: 3
---

TomoriBot có thể nói và nghe trong Discord: gửi câu trả lời bằng giọng nói bằng tính năng chuyển văn bản thành giọng nói (TTS) và chuyển âm tin nhắn sang ngữ cảnh hội thoại bằng tính năng chuyển lời nói thành văn bản (STT).

Cả hai đều sử dụng hệ thống điểm cuối của nhà cung cấp. ElevenLabs là tùy chọn đám mây nhanh nhất. Bạn cũng có thể chạy các mẫu giọng nói cục bộ trên phần cứng của riêng mình bằng cách sử dụng các công cụ self-hosting.

## Text-to-Speech
<!-- anchor: text-to-speech -->

### ElevenLabs (đám mây, dễ nhất)

1. Nhận khóa API từ [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Chạy `/providers`, chọn `Thêm nhà cung cấp mới`, chọn `ElevenLabs` và dán khóa. Dòng chảy này:
   - đăng ký điểm cuối giọng nói và điểm cuối phiên âm ElevenLabs,
   - kích hoạt cả hai điểm cuối,
   - tùy ý gán giọng nói cho một persona ngay lập tức.
3. Gán giọng nói cho các persona bổ sung trong `/config` > `Persona` > Voice. Duyệt qua các giọng nói trong [Thư viện giọng nói ElevenLabs](https://elevenlabs.io/app/voice-library), nơi bạn cũng có thể sao chép giọng nói của chính mình.

Chọn ElevenLabs trong `/providers`, sau đó chọn `Sửa endpoint` bất cứ khi nào bạn cần cập nhật khóa.

Ghi chú:

- Trên gói miễn phí, chỉ có giọng nói được tạo sẵn mới hoạt động. Duyệt qua [danh sách giọng nói được tạo sẵn](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Các ký tự được tính khi cô tạo tin nhắn thoại. Bậc miễn phí có giới hạn hàng tháng, vì vậy hãy theo dõi bảng điều khiển ElevenLabs của bạn.
- Trả lời bằng giọng nói yêu cầu `voice_message_enabled` trong `/config` > `Quyền hạn` và persona hoạt động phải được chỉ định giọng nói.
- Việc thay đổi `/config` > `Persona` > Giọng nói yêu cầu quyền Quản lý máy chủ trong máy chủ và vẫn khả dụng đối với chủ sở hữu trong DM.

Trong `/help`, chọn `Tính năng`, sau đó là `Giọng nói` để xem hướng dẫn tương tác trong Discord.

### Các engine clone giọng nói cục bộ (self-hosted)

Trên các phiên bản self-hosting, bạn có thể chạy máy chủ sao chép giọng nói cục bộ. Quy trình làm việc: khởi động máy chủ, đăng ký kết nối và model của nó trong `/providers`, chọn nó trong `/providers`, tải lên mẫu tham chiếu trong `/config` > `Model` > TTS Parameters & Voices, sau đó gán nó trong `/config` > `Persona` > Voice. Mọi định dạng âm thanh đều được chấp nhận (tự động chuyển đổi sang WAV đơn âm); Các clip dài 10 đến 20 giây không có nhạc nền là hiệu quả nhất.

Mỗi động cơ có hướng dẫn thiết lập riêng:

- [Chatterbox-Turbo/Nano](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/): nhân bản giọng nói tiếng Anh nhanh chóng với các thẻ cảm xúc như `[laugh]`.
- [Qwen3-TTS](/vi/self-hosting/local-endpoints/text-to-speech/qwen3tts/): đa ngôn ngữ (10 ngôn ngữ) cộng với chế độ VoiceDesign ngôn ngữ tự nhiên.
- [MOSS-TTS](/vi/self-hosting/local-endpoints/text-to-speech/moss/): nhân bản đa ngôn ngữ và thiết kế giọng nói tiếng Anh hoặc tiếng Trung.
- [IrodoriTTS](/vi/self-hosting/local-endpoints/text-to-speech/irodoritts/): Công cụ chuyên dụng của Nhật Bản đọc biểu tượng cảm xúc dưới dạng tín hiệu cảm xúc.

Xem [Bảng so sánh chuyển văn bản sang giọng nói](/vi/self-hosting/local-endpoints/text-to-speech/) để biết hướng dẫn về phần cứng và danh sách công cụ đầy đủ.

## Speech-to-Text
<!-- anchor: speech-to-text -->

Điểm cuối phiên âm biến tệp đính kèm âm thanh của người dùng thành văn bản cho ngữ cảnh cuộc trò chuyện. Việc bản ghi có được đăng công khai trong cuộc trò chuyện hay không được kiểm soát trong `/config` > `Hành vi` > Hành vi thông báo.

### ElevenLabs (đám mây)

Việc thêm ElevenLabs từ `/providers` sẽ đăng ký điểm cuối phiên âm cùng với lời nói. Sử dụng `/providers` để chuyển đổi giữa các điểm cuối phiên mã hiện hoạt.

### Các engine cục bộ (self-hosted)

- [WhisperX](/vi/self-hosting/local-endpoints/speech-to-text/whisperx/): đường dẫn cục bộ được đề xuất; khoảng 100 ngôn ngữ, được tăng tốc GPU, nhiều kích cỡ model.
- [KoboldCPP](/vi/self-hosting/local-endpoints/speech-to-text/koboldcpp/): hoạt động khi bản dựng của bạn hiển thị điểm cuối phiên âm tương thích với OpenAI.
- [thì thầm.cpp](/vi/self-hosting/local-endpoints/speech-to-text/whispercpp/).

Xem trung tâm [Chuyển giọng nói thành văn bản](/vi/self-hosting/local-endpoints/speech-to-text/) để biết danh sách công cụ đầy đủ. Để có bản tóm tắt Discord, hãy chạy `/help`, sau đó chọn `Tính năng` và `Chép lời`.
