---
title: "Cầu nối Matrix"
sidebar:
  order: 1
---

Kết nối phòng Ma trận với kênh Discord để mọi người có thể trò chuyện trên cả hai nền tảng. Tin nhắn được gửi từ Matrix xuất hiện trong Discord dưới dạng tin nhắn webhook và TomoriBot trả lời trực tiếp vào phòng Matrix.

Để biết kiến trúc triển khai và lưu trữ dịch vụ ứng dụng, hãy xem [Kiến trúc cầu ma trận](/en/architecture/integrations/matrix/bridge/).

## Thiết lập

1. Mời tài khoản bot Matrix vào phòng Matrix không được mã hóa.
2. Sao chép ID phòng nội bộ của phòng đó (trong hầu hết các máy khách: `Room Settings` > `Nâng cao` > `Internal Room ID`, được định dạng như `!abc:matrix.org`).
3. Chạy `/matrix link` trong kênh Discord mà bạn muốn kết nối và dán ID phòng.

Sau khi bot tham gia, nó sẽ đăng xác nhận trong Ma trận, nhưng bạn phải hoàn thành liên kết từ Discord bằng `/matrix link`. Để ngắt kết nối kênh cầu nối sau này, hãy chạy `/matrix unlink`.

## Sử dụng từ Matrix

- Trò chuyện bình thường khi phòng được liên kết. Tin nhắn ma trận chuyển tiếp vào kênh Discord.
- TomoriBot trả lời lại phòng Ma trận.
- Các lệnh văn bản Ma trận được hỗ trợ là `/kill` và `/refresh`.

## Các giới hạn hiện tại

- Không có lệnh gạch chéo từ Ma trận (ngoài `/kill` và `/refresh`).
- Không có tin nhắn trực tiếp hoặc lời nhắc thời gian hồi chiêu dựa trên DM.
- Hình đại diện ma trận không hiển thị với các tính năng tầm nhìn của bot.
- Tính năng ghim tin nhắn không khả dụng.
- Biểu tượng cảm xúc tùy chỉnh và định dạng phức tạp không hiển thị đáng tin cậy; nhúng chuyển tiếp dưới dạng văn bản thuần túy.
- Ký ức cá nhân của người dùng Matrix quay trở lại ký ức của máy chủ được phân bổ.

## Lưu ý

- Nếu bot không tự động tham gia, hãy mời tài khoản bot Matrix theo cách thủ công và chạy lại `/matrix link`.
- Không thể tắt mã hóa ma trận sau khi tạo phòng: phòng được mã hóa phải được thay thế bằng phòng mới không được mã hóa.
- Để hủy liên kết một kênh, hãy sử dụng `/matrix unlink`.
- Nếu sự cố không được liệt kê ở trên, hãy báo cáo sự cố đó trong máy chủ hỗ trợ bằng `/support discord`.

Trong `/help`, chọn `Plugin`, sau đó là `Matrix` để xem hướng dẫn tương tác trong Discord.
