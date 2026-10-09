---
title: "Hỗ trợ SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Dùng thẻ nhân vật SillyTavern trong Discord"
description: "Nhập thẻ nhân vật và preset prompt SillyTavern vào Discord với TomoriBot. Mang các nhân vật có sẵn vào máy chủ của bạn."
sidebar:
  order: 2
---

TomoriBot có thể nhập hai nội dung từ [SillyTavern](https://github.com/SillyTavern/SillyTavern): cài đặt trước của Trình quản lý lời nhắc (điều khiển cấu trúc lời nhắc) và thẻ ký tự (định nghĩa ký tự). Nếu bạn chưa bao giờ sử dụng SillyTavern, bạn có thể yên tâm bỏ qua trang này.

## Nhập thẻ nhân vật

Đưa ký tự SillyTavern hiện có vào Discord bằng `/persona import`. Nó chấp nhận:

- **Thẻ PNG** có siêu dữ liệu `chara` hoặc `char` được nhúng.
- **thẻ JSON kiểu v2** có thuộc tính cấp cơ sở (`name`, `description`, `first_mes`).
- **v3 thẻ JSON** (`spec: "chara_card_v3"` với đối tượng `data` lồng nhau).
- **Kho lưu trữ `.charx`** (Gói Thẻ nhân vật V3).

Tệp `.charx` là tệp lưu trữ ZIP chứa định nghĩa `card.json`. TomoriBot nhập văn bản ký tự từ `card.json` và bỏ qua các tệp nội dung đi kèm (biểu tượng, họa tiết, âm thanh, video). Bạn có thể đặt hình đại diện trong `/config` > `Persona` > Identity & Personal và thêm các họa tiết trong `/config` > `Persona` > Sprites.

Nếu tệp đã tải lên là thẻ SillyTavern hợp lệ không có siêu dữ liệu TomoriBot thì quá trình nhập sẽ tự động chuyển đổi tệp đó. Bạn cũng có thể chuyển thẻ cho `/persona generate` để tạo ra một persona mới mẻ lấy cảm hứng từ persona.

Quá trình nhập được xác thực trước khi lưu (giới hạn mặc định: 5.000 ký tự cho mỗi trường văn bản, 200 thuộc tính, 100 đoạn hội thoại mẫu mỗi bên, 100 từ kích hoạt). Để biết cơ chế chuyển đổi và ánh xạ trường, hãy xem [kiến trúc hỗ trợ thẻ](/en/architecture/integrations/sillytavern/card-support/).

## Preset prompt
<!-- anchor: prompt-presets -->

Cài đặt trước Trình quản lý lời nhắc SillyTavern kiểm soát thứ tự và bố cục của lời nhắc được gửi đến model. Mở `/config` > `Plugin` > SillyTavern Presets để nhập cài đặt trước, chuyển đổi các nút riêng lẻ, chuyển đổi cài đặt trước đang hoạt động hoặc khôi phục định dạng mặc định.

### Những gì preset kiểm soát

- Đặt hàng nhanh chóng và vị trí đánh dấu
- Nút nhắc tùy chỉnh
- Các nút sau lịch sử và tiêm sâu
- Trạng thái kích hoạt ban đầu cho các nút đã nhập

### Cái gì là một cài đặt trước không thay thế

Bố cục nhắc nhở cấu trúc đặt trước; nó không thay thế các nguồn văn bản điền vào nó:

- Hướng dẫn hệ thống và các trường cá nhân: `/config` > `Hành vi` > `Hành vi chung`, `/config` > `Persona` > Nâng cao và `/config` > `Persona` > `Danh tính & Tính cách`.
- Lịch sử trò chuyện trực tiếp và bối cảnh tài liệu được truy xuất.
- Bối cảnh tự động: ký ức máy chủ, dữ liệu biểu tượng cảm xúc và sticker, danh sách người tham gia và ký ức ngắn hạn.

### Cách các khối mặc định ánh xạ

Các khối gốc ánh xạ trực tiếp tới các thành phần nhắc nhở TomoriBot:

- `main`: lời nhắc hệ thống đang hoạt động (`/config` > `Hành vi` > `Hành vi chung` hoặc dự phòng mặc định)
- `charDescription`: `/config` > `Persona` > Nâng cao
- `charPersonality`: `/config` > `Persona` > `Danh tính & Tính cách`
- `dialogueExamples`: `/config` > `Persona` > `Danh tính & Tính cách`
- `chatHistory`: lịch sử tin nhắn kênh trực tiếp
- `worldInfoBefore` và `worldInfoAfter`: bối cảnh tài liệu được truy xuất (không phải sách truyền thuyết SillyTavern)

### Quy tắc prompt hệ thống

Khi giá trị đặt trước đã nhập được kích hoạt, lời nhắc hệ thống dự phòng tích hợp sẽ bị xóa. Tuy nhiên, nếu bạn định cấu hình lời nhắc hệ thống tùy chỉnh trong `/config` > `Hành vi` > `Hành vi chung`, lời nhắc đó luôn được bao gồm.

### Lưu ý về độ tương thích

- Các nút bị vô hiệu hóa trong `prompt_order` vẫn không hoạt động cho đến khi được bật trong Cài đặt sẵn `/config` > `Plugin` > SillyTavern. Các nút trống và chỉ nhận xét không bao giờ được gửi.
- Thứ tự chặn theo nghĩa đen: đặt `chatHistory` trước `dialogueExamples` đặt lịch sử trò chuyện lên đầu tiên trong lời nhắc.
- Nội dung chèn sau lịch sử sẽ hợp nhất vào lịch sử hội thoại hiện có thay vì gửi dưới dạng tin nhắn độc lập.
- Không hỗ trợ xử lý hậu kỳ Regex, các tham số lấy mẫu được xác định trước (nhiệt độ, top-p) và cài đặt trước theo lớp. Nhập các cài đặt trước hoàn thành văn bản kế thừa với các khối chỉ ST bị loại bỏ.

Trong `/help`, chọn `Plugin`, sau đó là `Preset SillyTavern` để có hướng dẫn Discord. Để biết cách xử lý đặt trước bên trong, hãy xem [kiến trúc hệ thống đặt trước](/en/architecture/integrations/sillytavern/preset-system/).
