---
title: "Chatterbox TTS"
aiGenerated: true
---

Sao chép giọng nói tiếng Anh với thẻ cảm xúc bằng cách sử dụng máy chủ chuyển văn bản thành giọng nói [Chatterbox](https://github.com/resemble-ai/chatterbox).

Chatterbox chạy cục bộ thông qua `servers/tts/chatterbox/server.py`. Nó mặc định là model Chatterbox-Turbo nhanh (thông số 350M) với các thẻ sự kiện cảm xúc nội tuyến như `[laugh]` và `[sigh]`. Bạn cũng có thể định cấu hình model Chatterbox-Nano nhẹ (thông số 110M) để thiết lập CPU hoặc model 0,5B tiêu chuẩn để có hướng dẫn không cần phân loại (`cfg_weight`) và điều chỉnh `exaggeration` theo cảm xúc. Trình bao bọc này không tải Chatterbox Multilingual V3.

## Cài đặt

Chạy các lệnh này từ thư mục gốc repo TomoriBot, thư mục nơi bạn đã sao chép TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Giữ thiết bị đầu cuối đó mở trong khi TomoriBot đang sử dụng Chatterbox. URL điểm cuối mặc định là `http://127.0.0.1:8011`; đặt `CHATTERBOX_PORT` để sử dụng cổng khác.

### Tùy chọn: sử dụng Chatterbox-Nano

Nano yêu cầu bản dựng Chatterbox với tùy chọn trình tải `nano=True`. Sau quá trình thiết lập bình thường ở trên, hãy cài đặt bản sửa đổi ngược dòng được ghim trong cùng một môi trường ảo. Hàm băm cam kết sửa phiên bản nguồn tương thích; nó không phải là một đảm bảo an ninh. Lệnh này yêu cầu `git` và giữ các phần phụ thuộc thời gian chạy đã được cài đặt:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Sau đó đặt `CHATTERBOX_FAST_MODEL=nano` trước khi khởi động trình bao bọc. Không đặt biến cho Turbo. Trên Windows PowerShell, đặt nó bằng `$env:CHATTERBOX_FAST_MODEL = "nano"`; trên Linux hoặc macOS, hãy sử dụng `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. Phản hồi `/health` báo cáo `fast_model` để bạn có thể xác minh lựa chọn đã tải. Nano và Turbo sử dụng cùng một yêu cầu nhân bản và thẻ sự kiện được hỗ trợ. Cả hai đều chỉ có tiếng Anh.

`Chuyển đổi model` nhanh `/config` phải luôn được bật để sử dụng Nano hoặc Turbo. Việc tắt nó sẽ chọn model Chatterbox 0,5B tiêu chuẩn để điều chỉnh trọng số và cường điệu CFG.

### Chatterbox tiêu chuẩn (0,5B với CFG và cường điệu)

Model Chatterbox cơ sở 0,5B ban đầu (`ChatterboxTTS`) được tích hợp trực tiếp vào trình bao bọc máy chủ. Nó giao dịch các thẻ sự kiện trong khung nội tuyến của Turbo để kiểm soát giọng hát chi tiết hơn bằng cách sử dụng Hướng dẫn không cần phân loại (`cfg_weight`) và `exaggeration` đầy cảm xúc.

Để sử dụng model Tiêu chuẩn:
1. Khởi động trình bao bọc máy chủ như bình thường.
2. Trong Discord, chạy `/config` > `Model` > `Tham số & Giọng đọc TTS`.
3. Tắt tùy chọn `Fast Model (Turbo)`.
4. Ở thế hệ tiếp theo, trình bao bọc tải xuống và tải model 0,5B tiêu chuẩn vào bộ nhớ một cách lười biếng.

Cả hai giá trị đều là trường văn bản ở chế độ `Sửa tham số`. Chúng luôn có thể chỉnh sửa được và trang lưu ý rằng chúng bị bỏ qua khi model nhanh được bật:
- **`cfg_weight`** (`0.5` mặc định): Điều chỉnh mức độ tuân thủ chặt chẽ của âm thanh tổng hợp với nhịp độ tham chiếu và phong cách giọng hát.
- **`exaggeration`** (`0.5` mặc định): Kiểm soát cường độ cảm xúc và chuyển biến kịch tính của cách truyền tải.

> [!GHI CHÚ]
> Chatterbox tiêu chuẩn không hỗ trợ các thẻ sự kiện trong khung nội tuyến (chẳng hạn như `[laughs]` hoặc `[sigh]`). TomoriBot tự động loại bỏ các thẻ ngoặc khỏi văn bản nhắc khi tắt `Chuyển đổi model` nhanh.

## Đăng ký trong TomoriBot

Bao gồm `Chatterbox` trong nhãn endpoint hoặc tên model. TomoriBot chỉ nhận diện endpoint Chatterbox qua tên đó (hoặc URL endpoint chứa tên đó), vì vậy danh sách cho phép thẻ Turbo, việc loại bỏ thẻ của model tiêu chuẩn, và các tùy chọn Chatterbox trong `/generate voice-message` chỉ áp dụng khi có tên này.

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm một model Speech. Chọn `Sao chép giọng đọc` làm Chế độ nguồn giọng đọc và `Thẻ trong ngoặc vuông` làm Script Markup để các thẻ truyền đạt vẫn còn khi gửi.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói cá nhân

1. Chuẩn bị một đoạn thoại ngắn gọn dài 10 giây với một loa và không có nhạc nền.
2. Mở `/config` trong Models > `Tham số & Giọng đọc TTS` và tải clip lên.
3. Mở `/config` trong Persona > `Giọng nói`, sau đó chọn persona và mẫu giọng nói.

Một đoạn clip dài hơn không bổ sung thêm điều gì cho Chatterbox và nó cũng không bị từ chối. Thời gian chạy của nó cắt bớt tham chiếu trước khi điều chỉnh, do đó, âm thanh qua cửa sổ sẽ được tải lên, lưu trữ và sau đó bị bỏ qua ([`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py), [`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)):

- Lời nhắc bằng âm thanh là 10 giây đầu tiên trên mỗi biến thể.
- Ngữ cảnh của mã thông báo lời nói là 15 giây đầu tiên trên Turbo và Nano và 6 giây trên Standard.

Các cửa sổ đó là các hằng số trong thời gian chạy ngược dòng chứ không phải là hướng dẫn đã xuất bản: kho lưu trữ README không cung cấp độ dài clip tham chiếu và tên tệp ví dụ của nó chỉ là `your_10s_ref_clip.wav`. Độ dài mà thời gian chạy thực sự thực thi là tối thiểu, khẳng định rằng lời nhắc dài hơn 5 giây.

Do đó, mười giây là mục tiêu thực tế. Nó lấp đầy lời nhắc âm thanh, nơi đặt âm sắc và cách phân phối, đồng thời một đoạn clip từ 10 đến 15 giây sẽ chỉ thêm bối cảnh mã thông báo lời nói trên Turbo và Nano. Việc nhúng người nói vẫn được tính toán từ toàn bộ clip, do đó, việc kéo dài thời gian hơn không làm thay đổi danh tính người nói mà chỉ loại bỏ bao nhiêu lời nhắc chưa đọc.

Turbo và Nano có thể sử dụng các thẻ sự kiện khung như `[laugh]` và `[sigh]` khi bật `Chuyển đổi model` nhanh.

## Điều chỉnh tùy chọn

Sử dụng `/config` trong Model > `Tham số & Giọng đọc TTS` để điều chỉnh tải trọng yêu cầu Chatterbox:

- `Chuyển đổi model` nhanh được bật theo mặc định. TomoriBot giữ lại các thẻ sự kiện Turbo/Nano được hỗ trợ và loại bỏ các bộ mô tả khung không được hỗ trợ trước khi trình bao bọc gọi `ChatterboxTurboTTS.generate(...)`.
- `cfg_weight` mặc định là `0.5`. Tối thiểu là `0`; TomoriBot không đặt mức tối đa cố định. Nó chỉ áp dụng khi `turbo` là `false`; các giá trị thấp hơn có thể giúp làm chậm các giọng nói tham chiếu nhanh, trong khi các giá trị cao hơn sẽ bám theo tham chiếu mạnh hơn.
- `exaggeration` mặc định là `0.5`. Tối thiểu là `0`; TomoriBot không đặt mức tối đa cố định. Nó chỉ áp dụng khi `turbo` là `false`; giá trị cao hơn làm cho việc truyền tải trở nên biểu cảm hoặc kịch tính hơn và có thể tăng tốc độ nói.

Các thẻ sự kiện Turbo/Nano được hỗ trợ là `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` và `[laugh]`. Các bộ mô tả không được hỗ trợ như `[excited]`, `[whisper]` hoặc `[smiles]` sẽ bị loại bỏ thay vì được gửi tới TTS.

Khi `turbo` bị tắt, TomoriBot sẽ loại bỏ tất cả các bộ mô tả khung trước khi gửi văn bản tới TTS, sau đó trình bao bọc tải model `ChatterboxTTS` tiêu chuẩn một cách lười biếng và gọi `model.generate(..., cfg_weight, exaggeration)`.
