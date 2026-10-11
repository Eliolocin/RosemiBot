---
title: "Thiết lập: slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

Chạy [slop-guard](https://github.com/eric-tramel/slop-guard), một trình kiểm tra văn phong dựa trên quy tắc, làm công cụ kiểm tra quy tắc cho [Duyệt phản hồi](/vi/features/chatting-personality/behavior-tweaking/#response-drafting). Nó chấm điểm từng câu trả lời bị giữ lại theo các khuôn mẫu hành văn rập khuôn và chuyển báo cáo cho người duyệt. Việc kiểm tra dựa trên quy tắc, do đó không tiêu tốn token.

slop-guard chỉ được phát hành dưới dạng một tiến trình stdio cục bộ. Thư mục `servers/slop-guard/` đóng gói phiên bản cố định (`0.5.0`) trong một container nhỏ cung cấp các công cụ tương tự qua MCP Streamable HTTP, vốn là cách TomoriBot kết nối với các máy chủ MCP.

## Khởi động máy chủ

### Lựa chọn A: Docker Compose (khi TomoriBot chạy trong Docker)

```sh
docker compose --profile slop-guard up -d
```

Container gia nhập mạng Docker của TomoriBot với tên `slop-guard`. Nó không mở bất kỳ cổng máy chủ lưu trữ nào.

### Lựa chọn B: Docker độc lập (khi TomoriBot chạy trên máy của bạn)

Khởi động bot cùng trình kiểm tra thay vì `bun run dev`:

```sh
bun run launch --slopguard
```

Lệnh này sẽ xây dựng image, khởi động một container `slop-guard` trên `127.0.0.1:8765`, đợi nó chấp nhận kết nối rồi chạy bot ở chế độ theo dõi. Container vẫn tiếp tục chạy sau khi nhấn `Ctrl+C`; dừng nó bằng `docker stop slop-guard`. Sau khi sửa đổi `servers/slop-guard/`, hãy xóa container cũ (`docker rm -f slop-guard`) để launch tạo container mới từ image vừa dựng lại.

## Đăng ký máy chủ

1. Mở `/config` > Plugin > MCP server và chọn `+ Thêm MCP`.
2. Đặt `URL máy chủ` thành `http://slop-guard:8765/mcp` (Lựa chọn A) hoặc `http://localhost:8765/mcp` (Lựa chọn B). Để trống `Token xác thực`.
3. Đặt `Loại máy chủ` thành `Trình kiểm tra văn phong`.
4. Mở `/config` > Plugin > Duyệt phản hồi và chọn `<tên máy chủ> / check_slop` trong mục `Kiểm tra quy tắc`.

`Trình kiểm tra văn phong` giúp các công cụ của máy chủ không bị lộ cho chính Tomori sử dụng. slop-guard cũng có `check_slop_file`, đọc đường dẫn tệp bên trong container; công cụ kiểm tra quy tắc sẽ không bao giờ cung cấp công cụ này vì nó không nhận văn bản câu trả lời.

Các địa chỉ cục bộ hoạt động được vì TomoriBot tự lưu trữ chạy với `RUN_ENV=development` (Compose ghim biến này). Với `RUN_ENV=production`, TomoriBot từ chối các URL MCP phân giải thành địa chỉ riêng tư hoặc địa chỉ loopback.

## Cài đặt

| Biến | Mặc định | Mục đích |
|---|---|---|
| `SLOP_GUARD_CONFIG` | các quy tắc đóng gói sẵn | Đường dẫn bên trong container tới tệp cấu hình quy tắc JSONL. Gắn tệp và trỏ biến này vào đó. |
| `SLOP_GUARD_PORT` | `8765` | Cổng lắng nghe. |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | Các giá trị tiêu đề `Host` mà máy chủ chấp nhận. Thêm tên máy chủ bạn đã nhập trong `URL máy chủ` nếu nó không có trong danh sách này; bất kỳ máy chủ nào khác sẽ nhận lỗi HTTP 421. |

Các quy tắc mặc định của slop-guard nhắm vào văn phong do AI tạo ra trong tài liệu và bài viết. Các câu trả lời nhập vai thông thường có thể kích hoạt một số quy tắc trong đó, chẳng hạn như gạch đầu dòng hoặc quy tắc liệt kê ba mục, vì vậy báo cáo mang tính khuyến nghị: người duyệt sẽ quyết định xem điểm khớp đó có quan trọng đối với nhân cách hay không. Hãy đề cập đến báo cáo trong prompt người duyệt nếu bạn muốn người duyệt cân nhắc báo cáo theo một cách cụ thể. Công cụ `sg-fit` của slop-guard có thể khớp cấu hình quy tắc với các ví dụ tốt và xấu của riêng bạn.

## Nâng cấp

Thay đổi phiên bản trong `servers/slop-guard/Dockerfile`, dựng lại image và gửi tin nhắn kiểm tra khi tính năng Duyệt phản hồi đang bật. Bản phát hành mới có thể thay đổi các quy tắc và định dạng báo cáo mà người duyệt đọc.
