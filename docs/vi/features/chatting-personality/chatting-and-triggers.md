---
title: "Trò chuyện & từ kích hoạt"
sidebar:
  order: 1
---

TomoriBot phản hồi khi được triệu tập. Trang này trình bày các cách có thể kích hoạt cô ấy, cách bật trò chuyện rảnh tay bằng trình kích hoạt tự động và cách ngăn chặn việc vô tình kích hoạt bằng Chế độ kích hoạt có chủ ý.

## Cách kích hoạt bot
<!-- anchor: how-to-trigger-her -->

Theo mặc định, cô ấy sẽ trả lời khi bạn:

- **Đề cập đến cô ấy**: `@TomoriBot`
- **Trả lời** một trong các tin nhắn của cô ấy (bao gồm tin nhắn webhook của một cá nhân)
- **Sử dụng từ kích hoạt**: mọi từ kích hoạt đã đăng ký ở bất kỳ đâu trong tin nhắn
- **Sử dụng `/respond`**: yêu cầu phản hồi theo cách thủ công

Trong DM, hãy gửi tin nhắn trực tiếp mà không cần bất kỳ từ kích hoạt hoặc đề cập nào.

### Quản lý từ kích hoạt
<!-- anchor: managing-trigger-words -->

Người quản lý máy chủ sử dụng `/config` > `Persona` > Trình kích hoạt để thêm hoặc xóa các từ kích hoạt cho persona đang hoạt động. Các thành viên không có Máy chủ quản lý có thể xem các trình kích hoạt hiện có ở chế độ chỉ đọc.

## Biểu cảm & cảm xúc phản hồi
<!-- anchor: expressions--reactions -->

Khi trả lời, cô ấy có thể sử dụng biểu tượng cảm xúc, sticker và phản ứng biểu tượng cảm xúc tùy chỉnh của máy chủ:

- Biểu tượng cảm xúc tùy chỉnh xuất hiện tự nhiên trong cuộc trò chuyện với cú pháp `:name:`.
- Cô ấy có thể gửi một sticker cho mỗi câu trả lời dưới dạng tin nhắn riêng trước, giữa hoặc sau tin nhắn của mình.
- Người quản lý máy chủ có thể thêm [biểu thức tùy chỉnh](/vi/features/chatting-personality/behavior-tweaking/#expressions) với `/expressions manage`: ảnh GIF phản ứng, hình ảnh đùa hoặc liên kết đến bất kỳ trang web nào.
- Chạy `/expressions initialize` để cô ấy biết khi nào biểu tượng cảm xúc và sticker của máy chủ phù hợp.

## Kênh nhập vai
<!-- anchor: roleplay-channels -->

Các kênh nhập vai sẽ loại bỏ các thông báo về biểu tượng cảm xúc và sticker tùy chỉnh trong phản hồi của cô ấy. Thành viên cũng có thể sử dụng `/tool delete turn` trong các kênh nhập vai để xóa lượt mới nhất của cô ấy mà không cần có quyền Quản lý Máy chủ.

Định cấu hình các kênh nhập vai trong `/config` > `Kênh` > Quy tắc kênh.

## Nhận biết ngữ cảnh xung quanh

Bất cứ khi nào cô ấy trả lời, cô ấy sẽ nhận được ngữ cảnh mô tả ở đâu và khi nào cuộc trò chuyện đang diễn ra:

- **Vị trí**: tên máy chủ, tên kênh hoặc cuộc trò chuyện có phải là Tin nhắn trực tiếp hay không.
- **Thời gian**: giờ địa phương của máy chủ và thời gian trong ngày từ `/config` > `Hành vi` > `Hành vi chung`, cộng với đồng hồ địa phương cho người dùng đặt múi giờ trong `/personal config`.
- **Người tham gia**: hiển thị tên, thẻ đề cập, thẻ xuất hiện và lời nhắc đang chờ xử lý.
- **Hoạt động Discord**: nội dung người tham gia hiện đang phát, phát trực tuyến, nghe (chẳng hạn như các bản nhạc trên Spotify) hoặc trạng thái tùy chỉnh của họ.

Trạng thái hoạt động yêu cầu mục đích `Guild Presences` của Discord và tôn trọng quyền riêng tư của người dùng (`/personal config`). Người dùng nâng cao cài đặt quyền riêng tư của họ sẽ không được đưa vào ngữ cảnh hiện diện.

## Tự động kích hoạt (Trò chuyện rảnh tay)

Tính năng tự động kích hoạt cho phép TomoriBot tham gia các cuộc trò chuyện mà không được đề cập trực tiếp:

- `/config` > `Kênh` > Tự động kích hoạt (hoặc `/server autotrigger channels`): chọn các kênh mà cô ấy phản hồi một cách tự động.
- `/config` > `Kênh` > Tự động kích hoạt (hoặc `/server autotrigger threshold`): đặt số lượng tin nhắn phải tích lũy trước khi cô ấy bấm chuông.
- `/config` > `Hành vi` > Hành vi kích hoạt: định cấu hình trình kích hoạt ngẫu nhiên dựa trên bộ đếm thời gian cho một kênh.

Sử dụng tính năng tự động kích hoạt trong các kênh thông thường chuyên dụng mà bạn muốn bot tham gia một cách tự nhiên.

## Chế độ kích hoạt có chủ đích
<!-- anchor: deliberate-trigger-mode -->

Nếu tên của một persona được sử dụng thường xuyên trong cuộc trò chuyện thông thường, những từ kích hoạt đơn giản có thể vô tình kích hoạt cô ấy. Chế độ kích hoạt có chủ ý (DTM) ngăn chặn việc vô tình kích hoạt bằng cách bỏ qua các từ kích hoạt không được trang trí.

Khi DTM hoạt động:

- `@{trigger}` (từ kích hoạt có tiền tố `@`) kích hoạt phản hồi
- Discord đề cập đến `@TomoriBot` vẫn kích hoạt phản hồi
- Trả lời tin nhắn vẫn hoạt động
- `/respond` vẫn hoạt động
- Những từ kích hoạt đơn giản không có `@` không còn kích hoạt cô ấy nữa

### Kiểm soát máy chủ và cá nhân

- `/server dtm`: người quản lý máy chủ chuyển đổi mặc định của máy chủ.
- `/personal config`: từng thành viên ghi đè cài đặt cho tin nhắn của riêng họ:
  - `off`: luôn cho phép các từ kích hoạt đơn giản
  - `follow`: làm theo cài đặt máy chủ
  - `on`: luôn yêu cầu lời gọi có chủ ý

Trong `/help`, chọn `Hành vi`, sau đó là `Chế độ kích hoạt có chủ đích` để xem bản tóm tắt Discord.

:::note
Chế độ kích hoạt có chủ ý (trang này) kiểm soát thời điểm cô ấy trả lời. Chế độ công cụ có chủ ý kiểm soát những công cụ nào được hiển thị cho model trong một lượt. Cả hai đều được viết tắt là "DTM" trong Discord; xem [Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/#deliberate-tool-mode).
:::
