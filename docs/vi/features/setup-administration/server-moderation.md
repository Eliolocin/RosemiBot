---
title: "Kiểm duyệt máy chủ"
sidebar:
  order: 2
---

TomoriBot cung cấp cho người quản lý máy chủ khả năng kiểm soát chi tiết về mức sử dụng, chi phí, quyền và kênh thông qua `/moderation` và `/config`. Hầu hết các điều khiển này đều yêu cầu sự cho phép của `Quản lý máy chủ`. Để biết danh sách lệnh đầy đủ, hãy xem [Tham khảo lệnh](/vi/features/command-reference/).

## Kiểm soát chi phí: Hạn ngạch
<!-- anchor: cost-control-quotas -->

Việc tạo điện sẽ tốn tiền, cho dù được thanh toán từ tài khoản nhà cung cấp của bạn hay bởi các thành viên của bạn. Hạn mức sử dụng giới hạn cho mỗi người dùng và trên toàn máy chủ:

- **Định cấu hình giới hạn**: trong `/moderation` > `Hạn ngạch`, định cấu hình giới hạn hàng ngày cho mỗi người dùng và nhóm đặt lại trên toàn máy chủ để tạo văn bản, hình ảnh và video. Đặt giới hạn cho mỗi người dùng thành `0` không giới hạn.
- **Đặt lại thủ công**: chạy `/quota reset user` để xóa mức sử dụng hàng ngày của thành viên hoặc `/quota reset global` để đặt lại toàn bộ nhóm máy chủ.

Nhóm trên toàn máy chủ tự động đặt lại theo khoảng thời gian có thể định cấu hình tính bằng ngày.

## BYOK người dùng (Bring Your Own Key)
<!-- anchor: user-byok-bring-your-own-key -->

Trong `/moderation` > `Quyền thành viên`, bạn có thể kiểm soát liệu các thành viên có thể sử dụng AI do máy chủ tài trợ hay không:

- **Cho phép model máy chủ** (mặc định): thành viên sử dụng nhà cung cấp được định cấu hình máy chủ.
- **Yêu cầu nhà cung cấp cá nhân**: thành viên phải định cấu hình khóa API của riêng họ thông qua `/personal providers`. Máy chủ không trả tiền cho các tin nhắn do thành viên khởi tạo. Các hành động do máy chủ khởi tạo (chẳng hạn như lời chào tự động hoặc tác vụ đã lên lịch) vẫn sử dụng nhà cung cấp máy chủ.

Thành viên định cấu hình nhà cung cấp cá nhân của họ trong [Cá nhân hóa](/vi/features/knowledge/personalization/#your-own-providers).

Bạn cũng có thể khởi động máy chủ mà không cần nhà cung cấp văn bản phía máy chủ bằng cách chọn `BYOK người dùng` trong `/setup`.

## Kiểm soát truy cập: Danh sách trắng

Sử dụng `/moderation` > `Whitelist` để hạn chế vị trí và cách TomoriBot phản hồi:

- **Kênh**: chọn kênh nào cho phép bot phản hồi và đặt ghi đè thời gian hồi chiêu dành riêng cho kênh. Các kênh kế thừa thời gian hồi chiêu chung trừ khi đặt ghi đè.
- **Personas**: hạn chế các kênh mà một cá nhân cụ thể có thể kích hoạt.
- **Vai trò**: hạn chế tương tác của bot đối với các thành viên có vai trò Discord cụ thể.

Định cấu hình thời gian hồi chiêu phản hồi toàn cầu trên toàn máy chủ trong `/config` > `Hành vi` > Hành vi kích hoạt.

## Kiểm soát học tập và quyền riêng tư

- **Quyền của thành viên**: trong `/moderation` > `Quyền thành viên`, nhấp vào `Sửa quyền hạn` để kiểm soát xem các thành viên không có `Quản lý máy chủ` có thể quản lý bộ nhớ máy chủ, thuộc tính cá nhân, hộp thoại mẫu hoặc kiểm tra ảnh chụp nhanh nhanh chóng hay không.
- **Danh sách đen người dùng**: trong `/moderation` > `Blacklist người dùng`, chọn thành viên cho TomoriBot để bỏ qua hoàn toàn. Các thành viên trong danh sách đen không thể kích hoạt cô ấy hoặc chạy lệnh và tin nhắn của họ không bao giờ đến được ngữ cảnh nhanh chóng. Bạn cũng có thể đặt khối thành viên dành riêng cho từng cá nhân.
- **Quy tắc kênh**: trong `/config` > `Kênh` > Quy tắc kênh, đánh dấu các kênh riêng tư (nơi bộ nhớ ngắn hạn vẫn bị cô lập và nhật ký suy nghĩ bị chặn) và danh sách chặn công cụ đa kênh.

## Tính minh bạch: Nhật ký suy nghĩ

Trong `/config` > `Kênh` > Nhật ký & Chào mừng, nhấp vào `Đặt kênh nhật ký` để chỉ định kênh nơi TomoriBot đăng lý luận nội bộ, thông báo dự phòng và lệnh gọi công cụ thành công. Điều này rất hữu ích cho việc kiểm tra những gì cô ấy đang làm, bao gồm cả trình kích hoạt nào đã hiển thị một công cụ trong [Chế độ công cụ có chủ ý](/vi/features/capabilities/tools-and-extensions/#deliberate-tool-mode).

Nhật ký chỉ sao chép từ các kênh mà mọi thành viên trong máy chủ của bạn đều có thể xem. Hoạt động trong kênh hoặc luồng mà một số thành viên không thể mở sẽ không được đưa vào nhật ký, do đó nhật ký không bao giờ hiển thị nội dung mà họ không thể đọc tại nơi diễn ra. Kênh nhật ký phải nằm trong cùng một máy chủ.

## Lời chào mừng

Trong `/config` > `Kênh` > Nhật ký & Chào mừng, định cấu hình lời chào tự động cho thành viên mới trong kênh đã chọn. TomoriBot đợi cho đến khi thành viên mới hoàn thành việc sàng lọc và giới thiệu các quy tắc của Discord trước khi gửi lời chào. Nếu một thành viên rời đi trước khi kết thúc buổi chiếu, sẽ không có lời chào nào được gửi đi. Nhấp vào `Xóa lời chào` trên cùng trang đó để tắt lời chào.

## Biểu cảm

Chạy `/expressions initialize` để lập chỉ mục các biểu tượng cảm xúc và sticker tùy chỉnh trên máy chủ của bạn để các cá nhân có thể sử dụng chúng một cách chính xác trong cuộc trò chuyện. Để biết cách các cá nhân sử dụng biểu tượng cảm xúc, sticker và phản ứng, hãy xem [Biểu cảm & Phản ứng](/vi/features/chatting-personality/chatting-and-triggers/#expressions--reactions).
