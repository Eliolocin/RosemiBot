---
title: "Tác vụ theo lịch"
sidebar:
  order: 2
---

Đặt lời nhắc cho chính bạn hoặc lên lịch thông báo định kỳ mà không cần rời khỏi cuộc trò chuyện. Hãy hỏi trực tiếp bot và cô ấy sẽ tạo lịch trình cho bạn. Nhiệm vụ theo lịch trình thuộc về persona tích cực.

Lời nhắc sẽ thông báo cho người dùng mục tiêu khi họ kích hoạt, trong khi tự thực hiện nhiệm vụ là những hành động mà cá nhân đó tự thực hiện vào thời gian đã lên lịch.

## Tạo một tác vụ

Nói với cô ấy những gì cần lên lịch trong cuộc trò chuyện:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
```

Cô phân tích thời gian được yêu cầu và sự lặp lại. Lời nhắc ping người dùng mục tiêu khi họ kích hoạt. Nhiệm vụ là những hành động thầm lặng mà cá nhân thực hiện khi thời điểm đến.

## Múi giờ

Thời gian tuyệt đối (chẳng hạn như "lúc 14:30" hoặc "vào thứ Sáu lúc 8 giờ tối") sử dụng múi giờ của máy chủ (`/config` > `Hành vi` > `Hành vi chung`) theo mặc định. Nếu bạn đặt múi giờ của riêng mình bằng `/personal config`, bot sẽ tự động chuyển đổi giờ địa phương của bạn. "nhắc tôi lúc 9 giờ sáng" nghĩa là 9 giờ sáng của bạn, ngay cả khi máy chủ ở múi giờ khác. Thời gian tương đối (chẳng hạn như "trong 2 giờ") không phụ thuộc vào múi giờ và luôn an toàn.

Khi lời nhắc nhắm mục tiêu đến người dùng có múi giờ cá nhân khác với múi giờ của máy chủ, xác nhận sẽ hiển thị cả hai đồng hồ: giờ máy chủ và giờ địa phương của mục tiêu. Nếu thời gian bị gắn nhãn sai, hãy sửa nó bằng tin nhắn tiếp theo hoặc `/scheduled-task edit`.

## Quản lý tác vụ

Hai lệnh gạch chéo cho phép bạn xem lại và điều chỉnh lịch trình hiện có:

- `/scheduled-task edit`: thay đổi nội dung của nhiệm vụ, thời gian kích hoạt tiếp theo, khoảng thời gian lặp lại hoặc mục tiêu nhắc nhở. Đặt khoảng thời gian thành `0` để thực hiện tác vụ định kỳ một lần.
- `/scheduled-task remove`: xóa lời nhắc hoặc nhiệm vụ.

Cả hai lệnh đều mở một bộ chọn liệt kê các lịch trình hiện có của bạn theo cá nhân, thời gian, kênh và tần suất lặp lại.

Một máy chủ có thể lưu tối đa 100 lời nhắc và tác vụ đang chờ xử lý cùng một lúc. Khi đạt giới hạn, TomoriBot sẽ thông báo cho bạn thay vì thêm mới; hãy xóa các mục cũ bằng `/scheduled-task remove` để có thêm chỗ trống.

## Cách thức gửi hoạt động

Lời nhắc chỉ được đánh dấu là hoàn thành sau khi gửi thành công. Nếu quá trình phân phối bị gián đoạn, TomoriBot sẽ tự động thử lại mà không làm thay đổi lịch định kỳ.

Nếu quá trình phân phối không thành công liên tục và đạt đến giới hạn thử lại, TomoriBot sẽ đăng một cảnh báo kèm theo nội dung và ID tác vụ đã lên lịch. Lời nhắc của người dùng không thành công sẽ ping mục tiêu để lời nhắc không bị bỏ lỡ, trong khi các tác vụ tự thực hiện không thành công sẽ không gửi ping. Sau đó, lịch trình một lần sẽ bị xóa, trong khi lịch trình định kỳ vẫn hoạt động cho lần xuất hiện tiếp theo và có thể được quản lý bằng `/scheduled-task edit` hoặc `/scheduled-task remove`.

---

Để biết thêm các tính năng, hãy xem [Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/).
