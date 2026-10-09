---
title: "Trình hướng dẫn thiết lập"
sidebar:
  label: "Trình hướng dẫn thiết lập"
  order: 1
aiGenerated: false
---

:::note
Người dùng muốn sử dụng Docker Compose nên bỏ qua trình hướng dẫn này, xem
[Docker Compose](/vi/self-hosting/docker-compose/) để biết phương thức cài đặt bằng container.
:::

`bun run setup` là phương thức self-host được khuyến nghị cho các bản cài đặt cục bộ dựa trên Bun. Lệnh này sẽ tạo tệp `.env`, tạo `CRYPTO_SECRET`, yêu cầu token bot Discord của bạn, định cấu hình PostgreSQL và cài đặt chính xác các phần phụ thuộc từ `bun.lock` theo cách tương tác, vì vậy bạn chỉ cần làm theo các lời nhắc. Lệnh này an toàn để chạy lại; các giá trị `.env` hiện có sẽ được giữ nguyên trừ khi bạn chọn cấu hình lại chúng.

## Lấy mã nguồn

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Chọn một phương thức

Sau khi chạy lệnh, bạn sẽ chọn một trong hai phương thức:

```bash
bun run setup
```

| Phương thức | Khi nào nên dùng | Tác vụ thực hiện |
|---|---|---|
| Full Install | Bạn muốn thiết lập được khuyến nghị cùng với các tiện ích bổ sung nhẹ. | Chạy Base Install, sau đó thử cài đặt bốn tiện ích bổ sung bên dưới. |
| Base Install | Bạn chỉ muốn bot tối thiểu có thể hoạt động. | Tạo và cấu hình `.env`, token Discord, PostgreSQL cùng các phần phụ thuộc. |

## Những thứ cần chuẩn bị sẵn

- [Bun](https://bun.sh/) để chạy bot và chính trình hướng dẫn này.
- Token bot Discord với các privileged intent `GuildMembers`, `MessageContent` và `GuildPresences` đã được bật.
- Cơ sở dữ liệu. TomoriBot lưu trữ mọi thứ trong PostgreSQL. Bạn không cần thiết lập thủ công vì trình hướng dẫn sẽ thực hiện giúp bạn: hệ thống sẽ dùng PostgreSQL nếu bạn đã cài sẵn, hoặc chạy cơ sở dữ liệu cho bạn trong [Docker](https://www.docker.com/) nếu chưa có. Bạn chỉ cần đảm bảo một trong hai đã được cài đặt trước khi bắt đầu.

:::caution
- Docker PostgreSQL đi kèm chỉ chạy cơ sở dữ liệu trong Docker. Bản thân bot, các bản sao lưu khi khởi động, `bun run backup` và `restore-backup` vẫn chạy thông qua Bun của máy chủ lưu trữ và các công cụ client PostgreSQL của máy chủ lưu trữ. Nếu bạn muốn chạy toàn bộ trong Docker, hãy sử dụng [Docker Compose](/vi/self-hosting/docker-compose/) để thay thế.
:::

Nếu thiếu `psql` hoặc việc cấp phát thất bại, trình hướng dẫn sẽ in ra câu lệnh SQL để bạn chạy thủ công. Dù bằng cách nào, TomoriBot cũng sẽ tự động khởi tạo schema, seed dữ liệu, migration, `pgcrypto` và schema RAG khi khởi động lần đầu.

## Tiện ích bổ sung của Full Install

Full Install sẽ chạy Base Install trước, sau đó thử cài đặt các tiện ích bổ sung bên dưới. Nếu có tiện ích nào thất bại, hệ thống sẽ in lệnh hoặc hướng dẫn để bạn hoàn tất thủ công và tiếp tục tiến trình:

| Tiện ích bổ sung | Mục đích |
|---|---|
| `pgvector` | Tìm kiếm vector cho bộ nhớ tài liệu/RAG. |
| `pg_cron` | Tùy chọn dọn dẹp theo lịch trình cho các hàng cooldown/lời nhắc. |
| Tokenizer asset | Tokenizer asset cục bộ để xử lý logit bias theo model. |

Để cài đặt thủ công bất kỳ tiện ích nào trong số này, hãy xem
[tiện ích bổ sung trong Cài đặt thủ công](/vi/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Sau khi thiết lập

```bash
bun run dev                          # chỉ bot
bun run launch --searxng --crawl4ai  # bot + máy chủ cục bộ (xem bun run launch --help)
```

Khi bot đã trực tuyến, hãy chạy `/setup` trong Discord để kết nối nhà cung cấp AI. Một không gian làm việc không có nhà cung cấp riêng sẽ không thể phản hồi, trừ khi chạy ở chế độ BYOK người dùng nơi nhà cung cấp cá nhân của từng thành viên sẽ trả lời thay thế, vì vậy đây là bước cuối cùng của mọi phương thức cài đặt.

## Lệnh `/setup`
<!-- anchor: the-setup-command -->

Lệnh `/setup` mở một bảng danh sách kiểm tra tạm thời mà chỉ người thực hiện lệnh mới có thể thao tác. Trong máy chủ, lệnh yêu cầu quyền Quản lý máy chủ; trong tin nhắn riêng (DM), lệnh khả dụng cho không gian làm việc của chính người đó. Mỗi hàng trên bảng là một giá trị nháp: `Hoàn tất thiết lập` là nút điều khiển duy nhất ghi dữ liệu, vì vậy việc mở, chỉnh sửa, hủy hoặc khởi động lại sẽ không làm thay đổi bất kỳ hàng nào trong cơ sở dữ liệu.

| Bước | Xuất hiện khi | Thông tin thu thập |
|---|---|---|
| Chính sách | Chỉ khi `RUN_ENV=production` | Chấp thuận Điều khoản dịch vụ và Chính sách quyền riêng tư, cả hai trong cùng một modal. |
| Nhà cung cấp AI | Mọi môi trường | Cách thức phản hồi tiếp cận model. Một trong ba chế độ truy cập bên dưới. |
| Cài đặt ban đầu | Mọi môi trường | Persona khởi đầu, phong cách phản hồi, múi giờ và system prompt mặc định của không gian làm việc. |

Mọi giá trị `RUN_ENV` khác đều hiển thị bố cục hai bước và hoàn toàn không có nội dung chính sách. Một bản triển khai chạy với `RUN_ENV=production` sẽ đăng ký `/legal terms-of-service` và `/legal privacy-policy` bên cạnh `/legal license`; mọi giá trị khác chỉ đăng ký `/legal license`.

### Chế độ truy cập nhà cung cấp

- **Nhà cung cấp AI (Khuyên dùng)**: chọn một nhà cung cấp từ danh mục và dán khóa API tương ứng. Khóa được xác thực với nhà cung cấp và mã hóa vào bản nháp; bảng điều khiển chỉ hiển thị thông tin rằng khóa đã được lưu, không bao giờ hiển thị chính khóa đó. Hãy chạy `/help`, sau đó vào `Thiết lập` > **Step 1: Lấy API key** để xem hướng dẫn từng bước cho từng nhà cung cấp.
- **Endpoint tùy chỉnh (Nâng cao)**: khu vực phụ gồm hai nút dành cho endpoint tự host hoặc proxy. `Cấu hình kết nối` thu thập khả năng tương thích API, nhãn, URL và token xác thực tùy chọn, đồng thời kiểm tra xem endpoint có phản hồi hay không. `Cấu hình model văn bản` thu thập mã model, kích thước ngữ cảnh và các khai báo tính năng của model, nút này sẽ bị vô hiệu hóa cho đến khi kết nối được xác thực thành công. Việc lưu lại kết nối một lần nữa sẽ xóa khai báo model, vì các khai báo này phụ thuộc vào khả năng tương thích API đã chọn. Đây chính là quy trình đăng ký mà `/providers` thực hiện, được tích hợp bên trong trình hướng dẫn và không tạo bất kỳ hàng nào trước khi nhấn `Hoàn tất thiết lập`.
- BYOK người dùng (chỉ dành cho guild, không áp dụng trong DM): không gian làm việc không giữ nhà cung cấp riêng và mọi phản hồi do thành viên kích hoạt sẽ sử dụng nhà cung cấp cá nhân của họ để xử lý. Hãy xác nhận điều này trong modal, sau đó yêu cầu các thành viên đăng ký nhà cung cấp của họ bằng `/personal providers`. Xem
  [Kiểm duyệt máy chủ](/vi/features/setup-administration/server-moderation/#user-byok-bring-your-own-key).

### Cài đặt ban đầu

Một modal bốn hàng sẽ thu thập persona, phong cách phản hồi, độ lệch múi giờ và system prompt mặc định. Múi giờ là tùy chọn và mặc định là UTC. System prompt cung cấp lựa chọn `Mặc định tích hợp sẵn (Khuyên dùng)` cùng mọi preset có trong danh mục của không gian làm việc: lựa chọn mặc định tích hợp sẵn không lưu bất kỳ văn bản prompt nào, do đó luôn theo sát bản mặc định đi kèm bot, còn lựa chọn preset sẽ lưu văn bản của preset đó tại thời điểm xác nhận. Việc xóa một persona hoặc prompt đã lưu khỏi danh mục sẽ mở lại bước này cho đến khi chọn một mục khác.

### Hoàn tất và hủy

Nút `Hoàn tất thiết lập` luôn bị vô hiệu hóa cho đến khi mọi bước hiển thị đã hoàn tất. Nút này sẽ xác thực lại các danh mục và trạng thái không gian làm việc, lưu toàn bộ bản nháp trong một transaction duy nhất và thay thế bảng điều khiển bằng biên nhận xác nhận. Nút `Hủy` sẽ hủy bỏ bản nháp và làm hết hạn mọi nút điều khiển trên bảng.

Bản nháp tồn tại trong tiến trình bot chứ không nằm trong cơ sở dữ liệu, vì vậy nó chỉ kết thúc khi bị hủy, hoàn tất hoặc khi tiến trình khởi động lại. Tối đa 200 bản nháp được lưu giữ cùng lúc; bản nháp cũ nhất sẽ bị loại bỏ khi đạt giới hạn. Nút điều khiển của một phiên không còn tồn tại sẽ không ghi bất kỳ dữ liệu nào.

## Cập nhật

Sử dụng lệnh cập nhật ưu tiên sao lưu: `bun run update`

Lệnh này sẽ chạy `bun run backup`, sau đó là
`git pull --rebase --autostash`, rồi đến `bun install --frozen-lockfile`. Thêm `--build` nếu bạn chạy từ `dist/`,
hoặc `--docker` cho bản triển khai Compose. Xem chi tiết đầy đủ trên trang
[Bảo trì và sao lưu](/vi/self-hosting/maintenance/).
