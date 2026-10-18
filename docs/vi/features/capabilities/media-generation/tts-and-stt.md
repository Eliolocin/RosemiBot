---
title: "Giọng nói: TTS & STT"
sidebar:
  order: 3
aiGenerated: true
---

TomoriBot có thể nói và nghe trong Discord: gửi câu trả lời bằng giọng nói bằng tính năng chuyển văn bản thành giọng nói (TTS) và chuyển âm tin nhắn sang ngữ cảnh hội thoại bằng tính năng chuyển lời nói thành văn bản (STT).

Chọn các nhà cung cấp giọng nói trong `/providers`, hoặc dùng `/personal providers` cho các model giọng nói Google hoặc OpenRouter của riêng bạn. Bạn cũng có thể chạy các model giọng nói cục bộ trên phần cứng của riêng mình.

## Text-to-Speech
<!-- anchor: text-to-speech -->

### Giọng đọc Google và OpenRouter

Việc thêm Google sẽ chọn Gemini Flash TTS cho `TTS (Thiết kế giọng đọc)`. Thêm OpenRouter sẽ chọn Fish S2.1 Pro trả phí cho `TTS (Sao chép giọng đọc)`, đồng thời chỉ điền Seed Audio 1.0 vào `TTS (Thiết kế giọng đọc)` khi vị trí đó đang trống. OpenRouter không bao giờ thay thế thiết kế Gemini hoặc Vertex mà bạn đã chọn, do đó cả hai nhà cung cấp đều có thể cùng hoạt động. Nếu bạn đã thêm OpenRouter trước khi có Seed, vị trí Thiết kế của bạn sẽ vẫn trống cho đến khi bạn chọn Seed. Việc thêm lại khóa OpenRouter cũng sẽ điền Seed vào vị trí Thiết kế đang trống, bao gồm cả vị trí bạn đã chủ động xóa. Flash-Lite và Fish miễn phí yêu cầu chọn model rõ ràng; tình trạng sẵn có và hạn mức của nhà cung cấp vẫn được áp dụng. Dùng `/config` > Model > Chuyển đổi model để thay đổi hoặc xóa một trong hai vị trí.
Các lựa chọn cá nhân và nút bật/tắt nằm trong `/personal config` > Model > Chuyển đổi model. Tắt một chế độ cá nhân cho phép chế độ đó sử dụng lựa chọn của máy chủ trong khi chế độ kia vẫn hoạt động.

Hãy dùng khóa API cho nhà cung cấp trong cùng phạm vi với lựa chọn. Chỉ đăng ký gói trò chuyện thôi thì chưa đủ quyền truy cập API. [Gói API miễn phí](https://ai.google.dev/gemini-api/docs/pricing) của Gemini có hạn mức dự án và các yêu cầu về điều kiện sử dụng; hãy kiểm tra quyền truy cập trong AI Studio. Fish miễn phí là một mã model riêng biệt, `fish-audio/s2.1-pro-free:free`, và phải được chọn rõ ràng. Sự cố với model miễn phí cá nhân vẫn có thể dự phòng sang lựa chọn trả phí của máy chủ khi bật "Dự phòng bằng model máy chủ".

Trong `/config` > Persona > Giọng nói, chọn `Mô tả giọng đọc` để lưu phần mô tả tối đa 1.000 ký tự. Bạn có thể soạn trước khi chọn model. Để dùng Fish hoặc một model sao chép cục bộ, hãy thêm bản tham chiếu trong `/config` > Model > Tham số & Giọng đọc TTS rồi gán trên trang Giọng nói của persona. Cả hai dữ liệu đầu vào vẫn được lưu khi bạn đổi nhà cung cấp. Chọn `Thiết kế giọng đọc` hoặc `Sao chép giọng đọc` để đặt mức ưu tiên; nếu đầu vào ưu tiên không có model phù hợp hoặc giọng đọc khả dụng, dữ liệu đầu vào đã lưu còn lại có thể được sử dụng. Trang sẽ giải thích nguồn nào đang có hiệu lực đối với các lựa chọn của máy chủ.

Chạy `/generate voice-message` để nhập một kịch bản ngắn, hoặc yêu cầu persona gửi tin nhắn thoại. Lệnh này cũng chấp nhận mô tả một lần hoặc tải lên bản tham chiếu. Các phần mô tả đã lưu sẽ tái sử dụng danh tính giọng đọc Gemini; việc chỉnh sửa sẽ hủy danh tính đó. Phần mô tả dùng một lần tạo ra danh tính tạm thời mà bot sẽ xóa sau khi tạo xong. Quá trình dọn dẹp thất bại sẽ được thử lại khi sử dụng lại thông tin xác thực đó; quản trị viên có thể cần xóa các giọng đọc trong bảng điều khiển của nhà cung cấp sau sự cố hoặc lỗi hết thời gian chờ không rõ ràng.
Các phần mô tả được đưa vào thẻ persona dạng PNG và JSON khi xuất; danh tính giọng đọc từ xa và việc gán tham chiếu sẽ bị loại trừ. Google lưu trữ danh tính đã thiết kế trong dự án API. Tính năng sao chép âm thanh tham chiếu của Gemini được hoãn lại cho đến khi bot có thể thu thập các bản ghi âm đồng ý.

Seed Audio hoạt động khác với Gemini. Nó xây dựng giọng đọc từ mô tả mỗi lần phát âm, vì vậy cùng một mô tả có thể nghe hơi khác nhau giữa các tin nhắn. Nếu bạn cần giọng đọc luôn giữ nguyên, hãy dùng Gemini hoặc mẫu tham chiếu. Seed hoạt động tốt nhất bằng tiếng Anh và tiếng Trung, đồng thời tạo tối đa hai phút âm thanh cho mỗi tin nhắn, do đó kịch bản của nó dừng ở mức 1.100 ký tự. Phần mô tả, chỉ dẫn đọc và kịch bản cũng dùng chung tổng cộng 2.048 ký tự, vì vậy mô tả dài sẽ để lại ít chỗ hơn cho kịch bản. Kịch bản không vừa sẽ bị từ chối trước khi gửi bất cứ điều gì, và bot sẽ yêu cầu bạn rút ngắn lại.
OpenRouter tính phí Seed theo số giây âm thanh, với chi phí mỗi phút cao gấp khoảng mười lần so với Fish. Để chuyển sang Gemini hoặc xóa vị trí này, hãy dùng `/config` > Model > Chuyển đổi model.

Các lỗi giọng nói cá nhân tuân theo cài đặt "Dự phòng bằng model máy chủ" và quyền hạn máy chủ. Lần chuyển dự phòng thành công sẽ xuất hiện trong biên nhận lệnh. Các nhà cung cấp có thể tính phí cho các tác vụ thất bại hoặc bị hủy; giới hạn kịch bản và âm thanh không đóng vai trò như mức trần chi tiêu.

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
