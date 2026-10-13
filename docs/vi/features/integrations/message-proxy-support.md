---
title: "Hỗ trợ proxy tin nhắn"
description: "Chọn một dịch vụ proxy tin nhắn Discord được hỗ trợ và để TomoriBot theo dõi an toàn các bài đăng lại bằng webhook đã xác minh."
sidebar:
  order: 3
---

Tính năng hỗ trợ proxy tin nhắn cho phép TomoriBot theo dõi các tin nhắn mà một bot Discord bên ngoài xóa và đăng lại qua webhook.

## Chọn dịch vụ

Chạy `/personal message-proxy service:pluralkit` hoặc `/personal message-proxy service:pluralbuddy`. Chọn `service:none` (hiển thị là Tắt) để hủy kích hoạt xử lý proxy. Đây là cài đặt cá nhân trên tài khoản Discord gửi tin nhắn gốc và đi theo tài khoản đó qua các máy chủ.

Sau khi TomoriBot thấy tin nhắn xác minh đầu tiên của một alter, hãy dùng `/personal config identity:` để chỉnh sửa hồ sơ và `/personal memories identity:` để chỉnh sửa bộ nhớ của alter đó. Tính năng tự động hoàn thành bao gồm các danh tính đã lưu từ cả hai dịch vụ ngay cả khi tính năng xử lý proxy đang tắt. Giao diện tài khoản, quyền riêng tư và cài đặt model vẫn nằm trên tài khoản chủ. Biệt danh được đặt trong TomoriBot sẽ giữ nguyên cho đến khi bị xóa; nếu không, tên hiển thị của dịch vụ sẽ được làm mới khi có tin nhắn xác minh. Xem [Hỗ trợ PluralKit](/vi/features/integrations/pluralkit-support/) để biết chi tiết về thành viên và tiểu sử.

## Ý nghĩa của việc kiểm tra an toàn

Tomori không bao giờ gán danh tính webhook từ tên hoặc avatar của nó. Dịch vụ đã chọn phải xác minh ID bài đăng lại, tài khoản chủ và ID alter ổn định. PluralKit cũng xác định chính xác tin nhắn gốc, nhờ đó TomoriBot có thể chuyển tiếp quyết định kích hoạt và đối tượng phản hồi. PluralBuddy không cung cấp ID gốc đó. TomoriBot sử dụng một tin nhắn gần đây từ cùng tài khoản chủ và kênh như một phương án khớp nối nỗ lực tối đa. Nếu bài đăng lại đến sau thời gian chờ ban đầu hoặc nhiều tin nhắn gốc bị trùng lặp, bài đăng lại có thể bị bỏ qua hoặc dẫn đến câu trả lời thứ hai. Việc xác minh không thành công hoặc xung đột sẽ không bao giờ tạo ra danh tính.

Đây là lý do tại sao Tupperbox hiện không được cung cấp như một lựa chọn. Tài liệu công khai của dịch vụ này mô tả tính năng proxy nhưng không có API chứng thực tin nhắn đáng tin cậy công khai mà TomoriBot có thể sử dụng an toàn.

## Độ trễ tin nhắn ngắn

Khi một dịch vụ được chọn, Tomori sẽ chờ trong giây lát trước khi xử lý từng tin nhắn máy chủ thông thường từ tài khoản của bạn. Điều này giúp dịch vụ có thời gian xóa và đăng lại tin nhắn. Tin nhắn không qua proxy sẽ tiếp tục được xử lý sau khi hết thời gian chờ. Bài đăng lại của PluralKit kế thừa quyết định kích hoạt và đối tượng phản hồi gốc. PluralBuddy sử dụng nội dung bài đăng lại đã được xác minh và so khớp nỗ lực tối đa với tin nhắn gần đây.

Những người tự vận hành (self-hosting) có thể tinh chỉnh cơ chế này bằng `MESSAGE_PROXY_WAIT_MS`. Các cài đặt truyền tải dịch vụ vẫn được tách riêng, chẳng hạn như thời gian chờ API của PluralKit và token tùy chọn. Việc tra cứu tin nhắn của PluralBuddy yêu cầu thông tin xác thực ứng dụng OAuth khi triển khai trong `PLURALBUDDY_CLIENT_ID` và `PLURALBUDDY_CLIENT_SECRET`. Người dùng cá nhân không cần cung cấp token. Adapter hiện tại chỉ truy vấn `pluralbuddy.app`; không hỗ trợ các phiên bản PluralBuddy tự host.
