---
title: "Thiết lập: SearXNG"
sidebar:
  order: 3
---

Thêm tìm kiếm web riêng tư, self-hosting vào TomoriBot bằng [SearXNG](https://docs.searxng.org/).

Công cụ `web_search` truy vấn chuỗi dự phòng động cơ: Brave, SearXNG và DuckDuckGo. Chạy phiên bản SearXNG cục bộ sẽ cung cấp nguồn tìm kiếm self-hosting khi nhà cung cấp bên ngoài đạt đến giới hạn tốc độ hoặc không thành công, đồng thời kích hoạt các danh mục tìm kiếm chuyên biệt: `science`, `it`, `files` và `music`.

Chọn đường dẫn thiết lập:

### Tùy chọn A: Docker Compose (khi TomoriBot chạy trong Docker)

Sử dụng đường dẫn này nếu bạn chạy TomoriBot với ngăn xếp Docker Compose của repo. Sau đó chạy với cấu hình `searxng`:

```sh
docker compose --profile searxng up -d
```

Đặt `SEARXNG_BASE_URL=http://searxng:8080/` trong `.env` trước khi bắt đầu cấu hình này. Bot sử dụng địa chỉ đó để tiếp cận dịch vụ `searxng`. Để lại biến không được đặt khi cấu hình tắt.

Nếu bạn chạy trực tiếp TomoriBot bằng `bun run dev`, hãy sử dụng đường dẫn độc lập bên dưới.

Đặt `SEARXNG_SECRET` trong `.env` thành một giá trị ngẫu nhiên riêng cho khóa ký của vùng chứa.

---

### Tùy chọn B: Docker độc lập (khi chạy `bun run dev`)

Đầu tiên, đặt `SEARXNG_BASE_URL=http://localhost:8080/` trong `.env` để bot biết nơi kết nối.

Sau đó, thay vì chạy trực tiếp TomoriBot với `bun run dev`, hãy sử dụng `bun run launch --searxng`. Điều này tự động xử lý vòng đời của vùng chứa và đợi vùng chứa hoạt động tốt trước khi khởi động bot:

```sh
bun run launch --searxng
```

Nếu bạn muốn tự mình quản lý vùng chứa, hãy giữ `SEARXNG_BASE_URL=http://localhost:8080/` trong `.env`. Trước tiên hãy xây dựng hình ảnh của kho lưu trữ để nó tải cài đặt tìm kiếm JSON và thay thế khóa ký:

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

Sau đó chạy nó:

PowerShell:

```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

Bash (Linux/macOS):

```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

Sau đó chạy `bun run dev` khi vùng chứa hoạt động tốt (`docker ps` hiển thị `(healthy)`). Nếu không có `SEARXNG_SECRET` trong môi trường vùng chứa, hình ảnh sẽ tạo khóa ký tạm thời.

---

### Tùy chọn C: Không SearXNG

Không đặt `SEARXNG_BASE_URL`. Chuỗi rơi trở lại `Brave → DuckDuckGo`.

Khi không có máy chủ SearXNG nào được định cấu hình, lược đồ `web_search` đã tập hợp không còn quảng cáo các danh mục chỉ dành cho SearXNG nữa. Các danh mục phổ biến (`text`, `image`, `video`, `news`) vẫn xuất hiện khi Brave được định cấu hình và tìm kiếm chỉ có văn bản xuất hiện khi chỉ có phần dự phòng DuckDuckGo tích hợp sẵn.

---

## Điều chỉnh kết quả hình ảnh

Kết quả hình ảnh SearXNG được xác thực HEAD, được nén tùy chọn và được đăng dưới dạng tệp đính kèm Discord: hình ảnh UX và Brave giống hệt nhau. Nếu tất cả các URL ứng cử viên không được xác thực, SearXNG sẽ trả về danh sách văn bản các liên kết hình ảnh thay vì lỗi cứng.

| Biến | Mặc định | Sự miêu tả |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (tối đa 10) | Có bao nhiêu hình ảnh hợp lệ được gửi đến Discord. Bị ghi đè bởi đối số `count` của LLM. |
| `SEARXNG_IMAGE_POOL` | `10` | Nhóm URL ứng viên khi LLM không chỉ định `count`. Khi `count` được chỉ định, nhóm là `count × 3` (giới hạn ở mức 30) để xử lý các lỗi bảo vệ liên kết nóng. |
| `WEB_SEARCH_TIMEOUT_MS` | — | Hết thời gian chờ yêu cầu cho mỗi động cơ. |

*(Xem `.env.optional.example` để biết tất cả các điều chỉnh được.)*
