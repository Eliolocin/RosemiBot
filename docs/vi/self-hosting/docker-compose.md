---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose chạy TomoriBot và PostgreSQL cùng nhau trong các thùng chứa. Đây là tùy chọn cài đặt thứ ba cùng với [trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/) và [thiết lập thủ công](/vi/self-hosting/manual-setup/): chọn tùy chọn này khi bạn muốn chạy mọi thứ trong Docker mà không cần cài đặt Bun hoặc PostgreSQL trên hệ thống máy chủ của mình. Nó bỏ qua trình hướng dẫn thiết lập tương tác và tự động cấu hình kết nối cơ sở dữ liệu.

:::caution[Host tools for updates]
`bun run update --docker` cần máy chủ Bun và Git để thực hiện các thay đổi mã. Bản sao lưu cơ sở dữ liệu của nó chạy bên trong vùng chứa ứng dụng. Bạn cũng có thể chạy sao lưu và khôi phục thủ công thông qua Compose; xem [Bảo trì & Sao lưu](/vi/self-hosting/maintenance/).
:::

## 1. Lấy mã nguồn

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Các giá trị `.env` bắt buộc

Bắt đầu từ tệp ví dụ:

```sh
cp .env.example .env
```

Đặt các biến bắt buộc này trong `.env`:

| Biến | Giá trị |
|---|---|
| `DISCORD_TOKEN` | Mã thông báo bot Discord của bạn (bật các ý định đặc quyền `GuildMembers`, `MessageContent` và `GuildPresences`). |
| `CRYPTO_SECRET` | Khóa mã hóa 32 ký tự được sử dụng để mã hóa các khóa API được lưu trữ. |
| `POSTGRES_PASSWORD` | Mật khẩu cơ sở dữ liệu. Mọi giá trị `POSTGRES_*` khác đều được cấu hình tự động. |

Tạo giá trị 32 ký tự ngẫu nhiên cho `CRYPTO_SECRET` bằng Docker, sau đó sao chép nó vào `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Tạo mật khẩu riêng cho `POSTGRES_PASSWORD`. Bạn có thể sao chép cài đặt điều chỉnh tùy chọn từ `.env.optional.example`.

:::note[Database connection is automatic]
Dịch vụ Compose PostgreSQL chạy ở chế độ phát triển (không có SSL) trên mạng Docker nội bộ. Hình ảnh đi kèm bao gồm `pgvector` và `pg_cron`, do đó bộ nhớ tài liệu, tìm kiếm vectơ và dọn dẹp theo lịch trình sẽ hoạt động ngay lập tức. Không đặt `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` hoặc `POSTGRES_DB` trong `.env`; Compose tự động cấu hình chúng.
:::

Trên Linux, tạo các thư mục gắn kết liên kết trên máy chủ và gán quyền sở hữu cho UID 1001 trước khi khởi động vùng chứa. Docker tạo các điểm gắn kết bị thiếu dưới dạng root, điều này ngăn vùng chứa bot lưu các bản sao lưu, nhật ký hoặc tải lên:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Xây dựng và chạy

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

Để bắt đầu sau này, chỉ `docker compose up` là đủ trừ khi bạn thay đổi mã hoặc phần phụ thuộc. Sau khi bot kết nối với Discord, hãy chạy `/setup` trong bất kỳ kênh máy chủ nào để thêm khóa nhà cung cấp AI của bạn. Xem [Khởi động nhanh](/vi/introduction/quickstart/) để biết các tùy chọn thiết lập trong Discord.

Soạn các chân `RUN_ENV=development` trong định nghĩa dịch vụ của nó để các bí mật `.env` và điểm cuối HTTP cục bộ hoạt động. Kiểm tra tình trạng vùng chứa báo cáo xem quy trình bot có đang chạy hay không; nó không kiểm tra kết nối cổng Discord. Để biết sự khác biệt của chế độ sản xuất (`RUN_ENV=production`) (trình quản lý bí mật, hạn chế mạng và số liệu), hãy xem [Kiến trúc bảo mật](/en/architecture/subsystems/security/).

## 4. Các máy chủ cục bộ tùy chọn (Compose profile)

Chạy các máy chủ trợ giúp cục bộ tùy chọn với cấu hình Compose để bạn chỉ bắt đầu những gì mình cần:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Khi bật SearXNG, hãy đặt `SEARXNG_BASE_URL=http://searxng:8080/` trong `.env`. Nếu không thì không đặt nó. Đặt `SEARXNG_SECRET` thành một giá trị ngẫu nhiên riêng cho việc ký yêu cầu SearXNG.

Xem [SearXNG](/vi/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/vi/self-hosting/local-endpoints/setup-crawl4ai/) và [Giám sát cục bộ](/vi/self-hosting/local-monitoring/) để biết thiết lập dành riêng cho máy chủ.

## Bảo trì, cập nhật và sao lưu

Sử dụng `bun run update --docker` để cập nhật bản sao lưu đầu tiên khi triển khai Compose. Để sao lưu hoặc khôi phục cơ sở dữ liệu Compose của bạn, hãy xem [Bảo trì và sao lưu](/vi/self-hosting/maintenance/). Trước khi tải phiên bản mới, hãy xem lại [Di chuyển an toàn](/vi/self-hosting/safe-migration/).
