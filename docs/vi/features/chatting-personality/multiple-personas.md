---
title: "Nhiều persona"
head:
  - tag: title
    content: "TomoriBot | Bạn đồng hành AI & Persona cho máy chủ Discord của bạn"
description: "Chạy nhiều bạn đồng hành AI trong một máy chủ Discord. Tùy chỉnh persona với avatar, từ kích hoạt và phong cách nói chuyện riêng."
sidebar:
  order: 2
---

Tên, avatar, đặc điểm, phong cách nói chuyện và hành vi của TomoriBot được lưu trong persona. Bạn có thể dùng nhiều persona cùng lúc, mỗi persona là một nhân vật riêng với từ kích hoạt và avatar webhook riêng. Trang này giải thích hành vi của persona. Xem [Bộ nhớ](/vi/features/knowledge/memory/) để quản lý kiến thức và bộ nhớ.

## Tạo persona

- `/persona create`: tạo persona tùy chỉnh từ đầu.
- `/persona generate`: yêu cầu AI tạo persona từ lời nhắc và hình ảnh (yêu cầu nhà cung cấp hỗ trợ đầu ra có cấu trúc). Bạn cũng có thể cung cấp thẻ TomoriBot hoặc thẻ SillyTavern hiện có (xem [Hỗ trợ SillyTavern](/vi/features/integrations/sillytavern-support/)).
- `/persona default`: chuyển sang một trong các nhân vật mặc định có sẵn.
- `/persona export` và `/persona import`: sao lưu hoặc chia sẻ các tệp persona. Nhập hỗ trợ thêm persona làm persona alter bằng trình kích hoạt và hình đại diện webhook của riêng persona đó.
- `/persona remove`: xóa persona alter.

## Persona alter

Persona alter cho phép nhiều nhân vật cùng hoạt động trong một máy chủ:

- Mỗi alter có tính cách, từ kích hoạt và avatar webhook riêng, nên từng nhân vật gửi tin nhắn với tên và ảnh riêng trong cùng kênh.
- Nhiều alter có thể trả lời cùng một tin nhắn, trong giới hạn đặt tại `/config` > `Hành vi` > `Hành vi kích hoạt`.
- Trả lời trực tiếp tin nhắn webhook sẽ tiếp tục cuộc trò chuyện với persona đó.
- Thêm alter bằng `/persona import`, chọn tùy chọn alter, rồi quản lý bằng `/persona` và `/persona remove`.

Xem [kiến trúc nhiều persona](/en/architecture/subsystems/multi-persona/) để biết cách định tuyến câu trả lời và xác định danh tính webhook.

## Định hình tính cách

Tinh chỉnh cách một persona trông, nói chuyện và cư xử:

### Thuộc tính
<!-- anchor: attributes -->

Mở `/config` > `Persona` > `Danh tính & Tính cách` để xác định các đặc điểm tính cách hoặc chi tiết hình thể (chẳng hạn như `friendly`, `red hair` hoặc `ends sentences with *Nya~*`).

### Mẫu hội thoại
<!-- anchor: sample-dialogues -->

Mở `/config` > `Persona` > `Danh tính & Tính cách` để dạy phong cách nói của cô ấy bằng cách sử dụng phần giữ chỗ `{user}` và `{bot}`:

- `{user}`: được thay thế bằng tên hiển thị hoặc biệt hiệu của người dùng thực tế.
- `{bot}`: được thay thế bằng tên persona hiện tại của cô ấy.

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

Lời khuyên cho các cuộc đối thoại mẫu hiệu quả:

- Viết những trao đổi tự nhiên thể hiện hơn là kể.
- Thể hiện giọng điệu và từ vựng mà bạn muốn cô ấy sử dụng.
- Thêm sự đa dạng vào một số ví dụ để cô ấy có thể khái quát hóa tốt.

### Tên và avatar

Mở `/config` > `Persona` > `Danh tính & Tính cách` để đặt tên cô ấy tự gọi và tải ảnh hồ sơ của mình lên.

Bạn cũng có thể đặt lời nhắc hệ thống tùy chỉnh trong `/config` > `Hành vi` > `Hành vi chung`; xem [Tinh chỉnh hành vi](/vi/features/chatting-personality/behavior-tweaking/).

### Thói quen đặt tên

Người quản lý máy chủ có thể mở `/config` > `Persona` > Thói quen đặt tên để đặt cách một cá nhân xưng hô với các thành viên:

- Định cấu hình các tiền tố, hậu tố và địa chỉ nam tính, nữ tính và trung tính riêng biệt.
- Các cá tính khác nhau có thể gọi cùng một người dùng bằng các chức danh khác nhau (chẳng hạn như một người gọi họ là "Thuyền trưởng" và một người khác gọi họ là "Senpai").
- Ghi đè cá nhân theo dõi từng người dùng trên các máy chủ; xem [Cá nhân hóa](/vi/features/knowledge/personalization/).

## Sprite (Avatar cảm xúc)
<!-- anchor: sprites-emotion-avatars -->

Sprite là các hình đại diện thay thế mà một persona chuyển sang trong khi trò chuyện để phản ánh cảm xúc (chẳng hạn như `happy`, `mad` hoặc `embarrassed`).

Khi trả lời, cô ấy chọn hình ảnh phù hợp với cảm xúc của mình. Để sử dụng một cái, cô ấy bắt đầu dòng trả lời bằng `PersonaName (label):` và Discord gửi tin nhắn đó với hình đại diện sprite phù hợp. Nếu không có sprite nào phù hợp, cô ấy sẽ trả lời bằng hình đại diện mặc định của mình.

Quản lý sprites trong `/config` > `Persona` > Sprites (yêu cầu Quản lý máy chủ):

- **Thêm hoặc thay thế**: chọn persona, cung cấp nhãn, tải hình ảnh lên (PNG, JPG hoặc GIF) và tùy ý viết hướng dẫn sử dụng mô tả thời điểm hiển thị hình ảnh đó.
- **Chỉnh sửa**: cập nhật nhãn, hình ảnh hoặc hướng dẫn của sprite hiện có.
- **Xóa**: xóa các họa tiết bạn không còn muốn nữa.
- **Xuất và nhập**: chia sẻ hoặc sao lưu gói sprite hoàn chỉnh của persona dưới dạng tệp.

Nút chuyển đổi `Lưu làm danh tính` hiển thị tác giả thông báo là `Label (Persona)` trong Discord, hữu ích cho các ký tự có nhiều dạng.

Việc thay thế hình đại diện của persona mặc định sẽ xóa các hình ảnh được tích hợp sẵn của persona đó vì chúng mô tả persona gốc. Các Sprite bạn tự thêm vào vẫn còn nguyên. Chạy `/persona default` sẽ khôi phục các sprite tích hợp.

## Chọn persona theo kênh

Để chọn persona nào trả lời bạn trong một kênh cụ thể mà không thay đổi cài đặt trên toàn máy chủ, hãy sử dụng Tiêu điểm cá nhân; xem [Cá nhân hóa](/vi/features/knowledge/personalization/#personal-spotlight).
