---
title: "Thiết lập: Máy chủ MCP cục bộ"
sidebar:
  order: 6
---

Kết nối các máy chủ TomoriBot với Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) chạy trên máy cục bộ hoặc mạng riêng của bạn để cung cấp các công cụ cục bộ tùy chỉnh.

Đối với máy chủ HTTPS từ xa, hãy xem [Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/#mcp-servers). Điểm cuối MCP cục bộ yêu cầu phiên bản self-hosting:

:::caution[Self-hosting only]
Máy chủ MCP cục bộ chỉ được hỗ trợ trên các phiên bản self-hosting. Bot được lưu trữ công khai yêu cầu HTTPS và chặn các địa chỉ cục bộ/riêng tư để bảo mật, do đó, nó không thể truy cập máy chủ trên `localhost` hoặc mạng LAN của bạn.
:::

## 1. Chạy máy chủ MCP cục bộ

Khởi động máy chủ MCP hiển thị truyền tải HTTP/SSE trên một cổng cục bộ. Ví dụ: nhiều máy chủ MCP chạy qua Node:

```sh
npx -y <some-mcp-server> --port 3000
```

Lệnh chính xác phụ thuộc vào máy chủ bạn đang chạy. Lưu ý URL và đường dẫn truyền tải mà nó in ra (thường là `http://localhost:3000/sse`).

## 2. Đăng ký trong Discord

Mở `/config` > `Plugin` > Máy chủ MCP, chọn `+ Thêm MCP`, đặt trường `URL máy chủ` thành điểm cuối cục bộ của bạn và giữ `Loại máy chủ` ở cài đặt `Mục đích chung` mặc định của nó:

```text
http://localhost:3000/sse
```

Để trống `Token xác thực (không bắt buộc)`: máy chủ cục bộ không yêu cầu mã thông báo xác thực.

## 3. Quản lý

Mở trang Cấu hình và chọn `Xóa` trên hàng của máy chủ. Xác nhận hủy đăng ký nó, ngắt kết nối ngay lập tức và giải phóng một khe cắm.

## Bảo mật

:::danger[Only add MCP servers you trust]
Ngay cả máy chủ cục bộ do bạn tự chạy cũng có thể hoạt động sai nếu mã của nó không đáng tin cậy. Máy chủ MCP độc hại có thể chèn lời nhắc vào model, lọc dữ liệu được truyền đến các công cụ của nó hoặc trả về kết quả có hại mà TomoriBot sẽ chuyển tiếp. Xem lại hoạt động của máy chủ MCP trước khi kết nối nó.
:::

Để biết quy trình MCP trực tuyến và chi tiết bảo mật đầy đủ, hãy xem [Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/#mcp-servers).
