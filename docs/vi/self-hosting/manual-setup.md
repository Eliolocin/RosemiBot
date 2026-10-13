---
title: "Cài đặt thủ công"
sidebar:
  order: 2
aiGenerated: false
---

:::note
Người dùng muốn sử dụng Docker Compose nên bỏ qua trình hướng dẫn này, xem
[Docker Compose](/vi/self-hosting/docker-compose/) để biết phương thức cài đặt bằng container.
:::

Đây là quy trình cài đặt thủ công dành cho người dùng kỹ thuật không muốn sử dụng trình hướng dẫn tự động. Nếu bạn muốn quy trình có hướng dẫn từng bước, hãy sử dụng [trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/) vì công cụ này sẽ tự tạo `.env`, tạo `CRYPTO_SECRET` an toàn, cấu hình PostgreSQL và chạy quá trình cài đặt cho bạn.

## Điều kiện tiên quyết

- [Bun](https://bun.sh/)
- PostgreSQL được cài đặt trực tiếp trên hệ thống, hoặc chạy trong Docker container (xem bước 2)

Schema PostgreSQL, `pgcrypto`, seed dữ liệu và migration sẽ tự động khởi tạo khi bot khởi động.

## 1. Cài đặt

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. Cấu hình

Tạo tệp môi trường của bạn từ ví dụ và điền vào các giá trị được yêu cầu:

```sh
cp .env.example .env
```

Yêu cầu:

- `DISCORD_TOKEN`: mã thông báo bot Discord của bạn (kích hoạt các ý định đặc quyền `GuildMembers`, `MessageContent` và `GuildPresences`).
- `CRYPTO_SECRET`: khóa mã hóa 32 ký tự (được sử dụng để mã hóa các khóa API được lưu trữ).
- Kết nối PostgreSQL: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

Giữ một bản sao được bảo vệ của bí mật mã hóa riêng biệt với các bản sao lưu cơ sở dữ liệu. Các bản sao lưu mới không chứa `.env`. Để xoay vòng, hãy sử dụng `CRYPTO_SECRET_V1`, `CRYPTO_SECRET_V2` hoặc bất kỳ phiên bản số nguyên dương nào sau đó, với tùy chọn chọn `CRYPTO_SECRET_CURRENT`. `CRYPTO_SECRET` vẫn là V1. Các lệnh khởi động và bảo trì sẽ tải cùng một nguồn: các giá trị môi trường cục bộ trong quá trình phát triển hoặc JSON được gắn / AWS Secrets Manager trong production. Xem [Xoay vòng khóa mã hóa](/vi/self-hosting/maintenance/#rotating-encryption-keys) trước khi thay thế một bí mật.

Trong các nguồn bí mật JSON, khóa chính phải là chuỗi. `CRYPTO_SECRET_CURRENT` chấp nhận một chuỗi chẳng hạn như `"2"` hoặc một số nguyên an toàn dương như `2` để đặt tên cho một phiên bản khả dụng.

:::note[No native PostgreSQL?]
Chỉ chạy cơ sở dữ liệu trong một vùng chứa, sau đó trỏ các giá trị `POSTGRES_*` vào đó:

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

Sau đó đặt `POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432` và người dùng/mật khẩu/db ở trên. Hình ảnh `pgvector/pgvector` gửi tiện ích mở rộng RAG được cài đặt sẵn; đổi nó lấy `postgres:16` nếu bạn không cần bộ nhớ tài liệu/RAG. Điều này chỉ chạy cơ sở dữ liệu trong Docker và bot vẫn chạy trên máy chủ Bun. Để có bot và cơ sở dữ liệu được chứa đầy đủ, hãy sử dụng [Docker Compose](/vi/self-hosting/docker-compose/).
:::

Điều chỉnh tùy chọn tồn tại trong `.env.optional.example`. Sao chép bất kỳ giá trị nào bạn muốn tùy chỉnh (giới hạn, thời gian chờ, chuyển đổi tính năng, URL máy chủ cục bộ, v.v.).

Biểu cảm tùy chỉnh tải lên mặc định cho các tệp cục bộ trong `data/custom-expressions/`. Giữ thư mục đó trên bộ lưu trữ liên tục. `EXPRESSION_STORAGE_BACKEND` chấp nhận `local`, `gcs` hoặc `s3`. Phần phụ trợ đám mây yêu cầu `EXPRESSION_STORAGE_BUCKET` và thông tin xác thực SDK tương ứng. S3 cũng sử dụng `AWS_REGION` (`us-east-1` mặc định) và `S3_ENDPOINT` tùy chọn. GCS sử dụng thông tin xác thực mặc định của ứng dụng. Biểu thức sử dụng cài đặt nhóm riêng của chúng; cài đặt lưu trữ hình đại diện không chọn nhóm biểu thức. Các đối tượng vẫn có thể đọc được thông qua SDK và được đính kèm dưới dạng byte, do đó, URL phương tiện được cung cấp công khai là không cần thiết. Giữ nguyên các khóa phụ trợ, nhóm và đối tượng khi khôi phục các tham chiếu hiện có.

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` giới hạn các biểu cảm tùy chỉnh trên mỗi máy chủ (mặc định `20`, tối thiểu `1`). Các liên kết và tệp đã tải lên chia sẻ giới hạn này trên tất cả các persona; biểu tượng cảm xúc và nhãn dán gốc bị loại trừ. Khởi động lại bot sau khi thay đổi. Việc giảm giới hạn sẽ giữ nguyên các biểu cảm hiện có và cho phép chỉnh sửa cũng như xóa, nhưng chặn các bổ sung mới cho đến khi số lượng giảm xuống dưới giới hạn.

## 3. Chạy

```sh
bun run dev
```

Khi bạn thấy `TomoriBot up and running!`, hãy vào Discord và chạy `/setup` trong máy chủ của bạn để kết nối nhà cung cấp AI và khởi tạo bot. Lệnh này mở một bảng danh sách kiểm tra có hướng dẫn, và không có dữ liệu nào được ghi cho đến khi bạn nhấn `Hoàn tất thiết lập`; xem [Lệnh `/setup`](/vi/self-hosting/setup-wizard/#the-setup-command) để biết các bước thực hiện và [Bắt đầu nhanh](/vi/introduction/quickstart/) cho các thao tác trong Discord.

Sử dụng `bun run launch` thay vì `bun run dev` nếu bạn muốn các máy chủ cục bộ tùy chọn (SearXNG, Crawl4AI, TTS/STT cục bộ) được khởi chạy cùng với bot:

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## Tiện ích bổ sung tùy chọn (bản "Full Install" thủ công)
<!-- anchor: optional-extras-the-manual-full-install -->

Phương thức Full Install của [trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/) bổ sung bốn tiện ích nhẹ lên trên bản cài đặt cơ bản. Không có tiện ích nào là bắt buộc để chạy bot, nhưng mỗi tiện ích sẽ mở khóa một tính năng. Nếu cài đặt thủ công, bạn có thể thêm bất kỳ tiện ích nào bạn muốn:

### `pgvector`: bộ nhớ tài liệu/RAG

RAG (tải lên tài liệu và truy xuất liên kênh) lưu trữ các vector nhúng trong cột `vector`, đòi hỏi tiện ích mở rộng [pgvector](https://github.com/pgvector/pgvector). Cài đặt tiện ích này cho phiên bản chính PostgreSQL của bạn:

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

Sau đó kích hoạt tiện ích một lần trên cơ sở dữ liệu của bạn. Kết nối bằng `psql` sử dụng các giá trị `POSTGRES_*` từ tệp `.env`: hệ thống sẽ nhắc nhập `POSTGRES_PASSWORD`:

:::note[Windows]
Không có gói pgvector dựng sẵn cho PostgreSQL nguyên bản trên Windows. Việc cài đặt đồng nghĩa với việc phải biên dịch từ mã nguồn cho đúng phiên bản PostgreSQL của bạn bằng Visual Studio C++ và `nmake` (xem [hướng dẫn trên Windows](https://github.com/pgvector/pgvector#windows) của pgvector). Cách đơn giản hơn trên Windows là chạy cơ sở dữ liệu trong container `pgvector/pgvector` như được chỉ ra trong mục [Cấu hình](#2-cau-hinh) ở trên, nơi tiện ích mở rộng đã được cài đặt sẵn.
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

Sau khi kết nối, hãy chạy:

```sql
CREATE EXTENSION vector;
```

Nếu không có pgvector, bot vẫn chạy bình thường nhưng các tính năng RAG sẽ hoàn toàn không khả dụng. Tiện ích mở rộng này cũng bắt buộc phải có trên cơ sở dữ liệu đích trước khi khôi phục bản sao lưu; xem chi tiết tại [Di chuyển an toàn](/vi/self-hosting/safe-migration/).

### `pg_cron`: các tác vụ dọn dẹp theo lịch trình

`pg_cron` cung cấp khả năng bảo trì định kỳ tùy chọn cho cơ sở dữ liệu (dọn dẹp các hàng cooldown/lời nhắc). Docker Compose từ kho lưu trữ này đã cấu hình sẵn tiện ích này.

:::caution[Không bắt buộc đối với lời nhắc hoặc từ kích hoạt]
`pg_cron` hoàn toàn chỉ phục vụ công việc dọn dẹp nội bộ vì nó chỉ dọn các hàng dữ liệu cũ. Việc gửi lời nhắc và kích hoạt ngẫu nhiên chạy trong chính ứng dụng, do đó các tính năng này hoạt động bình thường dù có hay không có `pg_cron`.
:::

Đối với PostgreSQL tự quản lý, hãy tìm tệp cấu hình đang hoạt động:

```sql
SHOW config_file;
```

Bật tiện ích mở rộng trong `postgresql.conf`: thêm vào `shared_preload_libraries` nếu tệp đã liệt kê các thư viện khác:

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

Khởi động lại PostgreSQL, sau đó:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Tokenizer asset: logit bias theo model

Logit bias (phạt lặp lại emoji/từ ngữ) yêu cầu các tokenizer asset cục bộ:

```sh
bun run setup:tokenizers
```

Một số họ model (ví dụ Gemma) bị hạn chế và yêu cầu [HuggingFace token](https://huggingface.co/settings/tokens) sau khi bạn chấp thuận giấy phép của họ:

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

Nếu không có bước này, logit bias sẽ tự động bị tắt trong im lặng và mọi thứ khác vẫn hoạt động bình thường.

Phương án dự phòng `fetch_url` an toàn và phương án dự phòng `web_search` của DuckDuckGo đều chạy trong tiến trình, vì vậy cả hai đều không cần cài đặt thêm.

## Bảo trì, cập nhật và sao lưu

Sau khi cài đặt, các script phía máy chủ lưu trữ (`bun run update`, `bun run backup`, `bun run restore-backup`, `bun run nuke-db`, `bun run rotate-keys`, …) cùng các quy trình cập nhật và sao lưu đều có trên trang [Bảo trì và sao lưu](/vi/self-hosting/maintenance/). Nếu bạn chuẩn bị kéo phiên bản mới về, hãy bắt đầu với [Di chuyển an toàn](/vi/self-hosting/safe-migration/).
