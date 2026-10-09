---
title: "Thiết lập: Codex CLI qua ChatMock"
sidebar:
  order: 5
---

Kết nối TomoriBot với tài khoản ChatGPT của bạn thông qua cầu nối tương thích với OpenAI cục bộ bằng cách sử dụng [ChatMock](https://github.com/RayBytes/ChatMock).

ChatMock chạy máy chủ API cục bộ chấp nhận các yêu cầu OpenAI tiêu chuẩn, cho phép nhà cung cấp `custom` của TomoriBot định tuyến các lần hoàn thành trò chuyện thông qua tài khoản của bạn.

## 1. Khởi động ChatMock

Cài đặt ChatMock bằng cách làm theo hướng dẫn trong [kho ChatMock](https://github.com/RayBytes/ChatMock).

Xác thực và khởi động máy chủ cục bộ:

```sh
chatmock login
chatmock serve
```

Theo mặc định, ChatMock nghe trên `http://127.0.0.1:8000/v1`.

## 2. Cấu hình TomoriBot

Trong Discord, định cấu hình nhà cung cấp `custom` của TomoriBot với các cài đặt sau:

- **URL điểm cuối**: `http://127.0.0.1:8000/v1`
- **Tên mẫu**: Mã định danh mẫu mà ChatMock mong đợi, chẳng hạn như `gpt-5.4` hoặc `gpt-5.3-codex`

`http://127.0.0.1:8000` trần cũng hoạt động: TomoriBot bình thường hóa nó thành `/v1` trước khi thêm `/chat/completions`.

Kích hoạt các cờ khả năng này cho ChatMock:
- **Gọi chức năng/Công cụ**: Có
- **Hiểu hình ảnh**: Có
- **Hiểu video**: Không
- **Đầu ra có cấu trúc**: Có

:::note[System prompt handling and port configuration]
Codex CLI không cho phép lời nhắc `system` tùy chỉnh, do đó TomoriBot chuyển đổi hướng dẫn `system` thành lượt `user` ban đầu. Đặt `CHATMOCK_PORT` trong `.env` để khớp với cổng ChatMock của bạn (mặc định là `8000`) để TomoriBot nhận ra điểm cuối và áp dụng điều chỉnh nhắc nhở này.
:::
