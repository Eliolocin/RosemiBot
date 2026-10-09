---
title: "Hướng dẫn di chuyển an toàn"
sidebar:
  order: 6
---

Khi bạn `git pull` mã nguồn mới và khởi động lại TomoriBot, bot sẽ tự động chạy các migration schema cơ sở dữ liệu khi khởi động. Điều này rất mạnh mẽ: bạn không cần phải quản lý các bản cập nhật SQL thủ công, nhưng điều đó cũng đồng nghĩa với việc các thao tác phá hủy dữ liệu có thể ảnh hưởng đến dữ liệu của bạn một cách âm thầm. Hướng dẫn này chỉ cho bạn cách bảo vệ dữ liệu trước khi kéo mã nguồn mới.

## Tại sao điều này lại quan trọng

Trình chạy migration của TomoriBot (trong `src/db/migrationRunner.ts`) thực thi tất cả các migration chưa được áp dụng theo thứ tự phiên bản. Các migration chỉ tiến về phía trước: nếu xảy ra sự cố, trình chạy sẽ không tự động rollback. Hầu hết các migration là những mở rộng an toàn (thêm cột mới, bảng mới), nhưng theo chính sách thiết kế nội bộ của dự án (OD-R-6), các thao tác có tính phá hủy như `DROP COLUMN` hoặc `DROP TABLE` đều được cho phép. Nếu một migration phá hủy chạy mà không có bản sao lưu, bạn sẽ mất dữ liệu vĩnh viễn. Khi còn nghi ngờ, hãy sao lưu trước.

## Sao lưu phương tiện biểu thức tùy chỉnh
<!-- anchor: custom-expression-media-backups -->

Bản sao lưu cơ sở dữ liệu giữ lại siêu dữ liệu biểu thức tùy chỉnh, tư cách thành viên cá nhân và tham chiếu lưu trữ. Chúng không bao gồm các byte phương tiện được tải lên hoặc nhập khẩu. Dừng bot trước khi sao lưu cơ sở dữ liệu và phương tiện cùng nhau. Với bộ nhớ cục bộ, sao chép `data/custom-expressions/` và khôi phục nó vào cùng một vị trí. Với GCS hoặc S3, hãy sao lưu các đối tượng `custom-expressions/` được sở hữu và khôi phục các khóa của chúng trong nhóm biểu thức đã định cấu hình. Khôi phục cài đặt `EXPRESSION_STORAGE_BACKEND` và `EXPRESSION_STORAGE_BUCKET` phù hợp. Chỉ thay đổi phần phụ trợ hoặc nhóm sẽ khiến các tài liệu tham khảo hiện có không thể đọc được. Biểu thức liên kết chỉ được lưu trữ dưới dạng URL và vẫn phụ thuộc vào máy chủ bên ngoài của chúng. Xuất JSON Discord không mang theo sổ đăng ký biểu thức hoặc kho lưu trữ phương tiện.

## Danh sách kiểm tra trước khi kéo mã nguồn

Thực hiện theo các bước sau TRƯỚC KHI chạy `git pull`:

1. **Dừng bot**: tắt tiến trình TomoriBot để không có kết nối cơ sở dữ liệu nào đang hoạt động can thiệp vào quá trình sao lưu.
2. **Sao lưu cơ sở dữ liệu và lưu giữ khóa**: sử dụng một trong hai phương pháp bên dưới. Giữ một bản sao được bảo vệ riêng biệt của mỗi phiên bản mã hóa mà bản dump cần và kiểm tra quá trình khôi phục trên một cơ sở dữ liệu dùng một lần.
3. **Ghi lại commit hiện tại**: chạy `git rev-parse HEAD` và lưu lại kết quả phòng trường hợp cần rollback.
4. **Kéo mã nguồn và khởi động lại**: khi bản sao lưu đã nằm an toàn trên ổ đĩa, bạn có thể yên tâm kéo mã nguồn mới và khởi động lại.

### Điều kiện tiên quyết: tiện ích mở rộng `pgvector`

Một bản sao lưu đầy đủ là bản `pg_dump` dạng plain-SQL (`backupData.ts` chạy `pg_dump --clean --if-exists -f`), do đó nó chứa bảng `document_chunks` kiểu `vector` dùng cho RAG. Postgres đích bắt buộc phải có sẵn tiện ích mở rộng `pgvector` trước khi bạn khôi phục, nếu không lệnh `CREATE EXTENSION IF NOT EXISTS vector` của bản dump sẽ không thể chạy và bảng `document_chunks` sẽ không thể tạo được.

Cài đặt tiện ích một lần trên máy chủ lưu trữ (khớp với phiên bản chính Postgres của bạn), ví dụ cho Postgres 16:

```bash
sudo apt-get install -y postgresql-16-pgvector
```

Xác nhận tiện ích đã khả dụng:

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

Nếu bạn khôi phục mà không có tiện ích này:

- Lệnh `restore-backup` của dự án (và bất kỳ lệnh `psql -f` nào chạy với `ON_ERROR_STOP=1`) sẽ hủy sớm với thông báo `extension "vector" is not available`: không có dữ liệu nào được nạp. Hãy cài đặt pgvector và thử lại.
- Một lệnh `psql -f` chạy thủ công bỏ qua lỗi (`ON_ERROR_STOP=0`) còn tồi tệ hơn: lệnh `COPY public.document_chunks` bị thất bại làm mất đồng bộ bộ phân tích cú pháp đầu vào của psql, khiến psql phân tích nhầm các hàng dữ liệu `COPY` tiếp theo thành câu lệnh SQL (gây ra một chuỗi `syntax error at or near …`). Điều này âm thầm xóa toàn bộ các bảng (đã ghi nhận: `documents` và `llms`), để lại một cơ sở dữ liệu được khôi phục một phần trông có vẻ nguyên vẹn nhưng đã bị mất dữ liệu. Luôn khôi phục với `ON_ERROR_STOP=1` để các lỗi xuất hiện ngay lập tức.

### Tùy chọn A: Sử dụng script sao lưu của dự án

TomoriBot đi kèm hai script sao lưu, mỗi script nhắm vào các dữ liệu khác nhau:

- **`bun run backup`**: Bản dump đầy đủ schema cơ sở dữ liệu + dữ liệu (persona, bộ nhớ, cấu hình, mọi thứ)
- **`bun run backup:personas`**: Chỉ bao gồm các preset persona và bộ nhớ máy chủ theo từng persona

Để di chuyển an toàn, hãy sử dụng bản sao lưu đầy đủ:

```bash
bun run backup
```

Lệnh này tạo một gói có gắn nhãn thời gian trong `backups/` (hoặc `TOMORI_BACKUP_DIR` nếu được ghi đè trong `.env`) chứa toàn bộ cơ sở dữ liệu PostgreSQL dưới dạng bản dump SQL thuần. Gói không chứa `.env` hoặc secret chính nào. Trước khi khôi phục, hãy cung cấp các phiên bản mã hóa phù hợp một cách riêng biệt trong nguồn secret đích và dừng tất cả các phiên bản bot. Xem [Sao lưu cơ sở dữ liệu và khóa khôi phục](/vi/self-hosting/maintenance/#database-backups-and-recovery-keys) để biết quy trình đầy đủ. Các khóa bị thiếu hoặc sai sẽ dừng việc khôi phục trước khi thực thi SQL mang tính phá hủy. Các gói cũ vẫn chứa các secret `config.env` thô; hãy xem lại chúng một cách riêng tư và tự cung cấp các khóa của chúng. Khôi phục không bao giờ sao chép tệp đó. Để khôi phục sau này, hãy chạy:

```bash
bun run restore-backup --latest
```

Hoặc khôi phục từ một gói cụ thể:

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### Sao lưu cục bộ tự động khi khởi động

Trong môi trường không phải production (`RUN_ENV` không đặt là `production`), TomoriBot cũng kiểm tra xem có bản sao lưu dữ liệu đầy đủ hay không trước khi quá trình khởi tạo cơ sở dữ liệu chạy. Hệ thống sẽ tự động tạo một gói tương thích với `backupData.ts` khi thỏa mãn một trong hai điều kiện:

- bản sao lưu dữ liệu đầy đủ mới nhất được tạo bởi một phiên bản bot `package.json` khác
- bản sao lưu dữ liệu đầy đủ mới nhất đã tồn tại ít nhất `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` giờ (mặc định: `24`)

Các bản sao lưu tự động được gắn thẻ `backupType: "automatic"` trong `bundle_info.json` và được đặt tên với hậu tố `_auto`. Các gói `bun run backup` thủ công được gắn thẻ `manual`; chúng có thể thỏa mãn điều kiện kiểm tra bản sao lưu mới nhất, nhưng không bao giờ tính vào số lượng lưu giữ tự động. Cơ chế khởi động giữ lại tối đa `TOMORI_AUTO_BACKUP_MAX` gói tự động mới nhất (mặc định: `5`) và chỉ xóa các gói tự động cũ hơn.

Đặt `TOMORI_AUTO_BACKUP_ENABLED=false` trong `.env` nếu bạn cần khởi động bot cục bộ/phát triển mà không có cơ chế bảo vệ này, ví dụ trên một máy không có `pg_dump`.

### Tùy chọn B: Sử dụng `pg_dump` trực tiếp

Nếu bạn thích kiểm soát thủ công, hãy sử dụng tiện ích `pg_dump` tích hợp của PostgreSQL với các biến môi trường của chính TomoriBot:

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

Lệnh này lưu một bản dump nhị phân định dạng tùy chỉnh (gọn hơn so với văn bản SQL). Các biến môi trường khớp với tệp `.env` của bạn:

- `POSTGRES_HOST`: mặc định `localhost`
- `POSTGRES_PORT`: mặc định `5432`
- `POSTGRES_USER`: người dùng DB của bạn
- `POSTGRES_DB`: mặc định `tomodb`

Để khôi phục:

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

Lưu ý: `pg_restore` sẽ yêu cầu mật khẩu trừ khi bạn đã thiết lập mật khẩu trong tệp `.pgpass` (tệp lưu thông tin xác thực tích hợp của PostgreSQL).

## Dành cho cộng tác viên triển khai qua CI: quy ước `(Checkpoint)`

Nếu bạn duy trì một bản fork triển khai lên AWS hoặc GCP thông qua các workflow trong `.github/workflows/deploy-{aws,gcp-legacy}.yml`, các quy trình này hỗ trợ tùy chọn chụp nhanh trước khi triển khai: khi một thông điệp commit chứa token ký tự `(Checkpoint)`, workflow sẽ chạy `aws rds create-db-snapshot` (hoặc lệnh tương đương của GCP Cloud SQL) trước khi bất kỳ mã nào được triển khai và trước khi trình chạy migration can thiệp vào cơ sở dữ liệu khi khởi động.

Sử dụng tùy chọn này khi:

- Bạn đang phát hành một migration xóa cột, xóa bảng, thay đổi kiểu cột hoặc có khả năng gây mất dữ liệu khác (chính sách migration phá hủy OD-R-6).
- Bạn đang phát hành một commit gói phát hành kết hợp nhiều migration và muốn có một điểm rollback duy nhất.
- Bạn không chắc chắn liệu một migration đang chờ có an toàn hay không: khi còn nghi ngờ, hãy checkpoint.

Bỏ qua tùy chọn này cho các lần triển khai thông thường không phá hủy (thêm cột mới, thêm index mới, bổ sung dữ liệu seed): bản chụp nhanh có chi phí tài nguyên thực tế và quy trình thông thường không cần đến nó.

Ví dụ thông điệp commit:

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

Token `(Checkpoint)` có thể xuất hiện ở bất kỳ đâu trong tiêu đề hoặc phần thân commit: nó được đối sánh phân biệt chữ hoa chữ thường với thông điệp của commit đầu nhánh. Việc kích hoạt workflow thủ công với tùy chọn sao lưu được bật là công cụ tương đương cho các trường hợp đặc biệt.

## Cần làm gì nếu một migration thất bại giữa chừng

Nếu bot bị crash hoặc treo trong quá trình migration:

1. **Dừng bot ngay lập tức**: không để bot thử lại migration một cách mù quáng.

2. **Kiểm tra nhật ký**: TomoriBot mặc định ghi log ra stdout/stderr (được thu thập bởi trình quản lý tiến trình hoặc nhật ký Docker của bạn). Tìm thông báo lỗi chỉ định tên của migration bị lỗi. Ví dụ đầu ra:

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **Quyết định xem có khôi phục hay không**: nếu lỗi không thể khắc phục được (ví dụ: migration cố gắng xóa một cột không tồn tại), hãy khôi phục từ bản sao lưu của bạn:

   ```bash
   # Option A restore
   bun run restore-backup --latest

   # Or Option B restore
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **Rollback mã nguồn**: quay lại commit hoạt động gần nhất:

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   Sử dụng mã băm bạn đã lưu ở bước 3 của danh sách kiểm tra trước khi kéo mã nguồn, hoặc tìm mã đó bằng:

   ```bash
   git log --oneline | head -20
   ```

5. **Báo cáo lỗi**: gửi báo cáo lỗi tại [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) kèm theo:
   - Tên tệp migration bị lỗi (từ log)
   - Toàn bộ thông báo lỗi
   - Mã băm của commit thành công gần nhất
   - Hệ điều hành, phiên bản Bun (`bun --version`) và phiên bản PostgreSQL của bạn

## Những gì KHÔNG THỂ tự động khôi phục

Theo thiết kế của dự án (OD-R-6), các migration phá hủy không thể được rollback bởi trình chạy migration. Ví dụ:

- `DROP COLUMN name_here`: các hàng dữ liệu bị xóa sẽ mất vĩnh viễn; không có script SQL nào có thể khôi phục chúng
- `DROP TABLE old_table`: toàn bộ bảng bị xóa hoàn toàn
- Thu hẹp kiểu dữ liệu (ví dụ `VARCHAR(255) → VARCHAR(100)`): các giá trị dài hơn 100 ký tự sẽ bị cắt bớt

Đối với các thao tác này, cách khôi phục duy nhất là sử dụng bản sao lưu của bạn. Luôn sao lưu trước khi kéo mã nguồn nếu bạn đang ở phiên bản cũ và một đợt tái cấu trúc mới được phát hành.

Thiết kế chỉ tiến về phía trước của trình chạy migration là có chủ đích: các tệp rollback (`.down.sql`) tồn tại vì sự an toàn của nhà phát triển trong quá trình thử nghiệm, nhưng việc khôi phục trên production sử dụng các bản sao lưu và các khóa mã hóa được giữ riêng biệt của chúng. Việc thực thi lại một migration có tính phá hủy không thể khôi phục dữ liệu đã bị xóa.

## Thử nghiệm một nhánh tính năng, sau đó quay lại `main`

Một trường hợp phổ biến: ai đó yêu cầu bạn thử nghiệm một nhánh trên bản cài đặt hiện có của bạn, và bạn muốn biết liệu việc chuyển sang nhánh đó, khởi động bot, rồi chuyển lại về `main` có làm hỏng cơ sở dữ liệu của bạn hay không.

Các sự thật then chốt:

- Git và PostgreSQL là hai thế giới tách biệt. Lệnh `git checkout` chỉ hoán đổi các tệp trên ổ đĩa; nó không bao giờ kết nối hay sửa đổi cơ sở dữ liệu của bạn. PostgreSQL lưu trữ trạng thái migration đã áp dụng trong bảng `schema_migrations`. Việc chuyển đổi nhánh git không làm thay đổi bảng đó.
- Các migration chạy tự động khi khởi động (thông qua `initializeDatabase.ts`), vì vậy ngay khi bạn khởi động nhánh đó, các migration mới của nó sẽ được áp dụng cho bất kỳ cơ sở dữ liệu nào mà bạn trỏ tới.
- Trình chạy tiến không bao giờ tự động rollback. Khi bạn quay lại `main`, nó quét các tệp trên ổ đĩa, không tìm thấy mục nào đang chờ xử lý và không làm gì cả. Các migration mà nhánh đó đã áp dụng vẫn sẽ giữ nguyên.

Vậy điều đó có an toàn không? Điều này hoàn toàn phụ thuộc vào những gì các migration của nhánh đó đã thực hiện:

- **Chỉ bổ sung** (bảng mới / cột mới) → an toàn. Các đối tượng mới chỉ nằm đó và không được sử dụng; mã nguồn của `main` không bao giờ tham chiếu đến chúng, vì vậy chúng không thể gây ra kết quả sai hoặc crash. Chỉ xóa các đối tượng không sử dụng thông qua một migration đã được duyệt.
- Có tính phá hủy (`DROP`/`RENAME`/`ALTER` trên bảng mà `main` vẫn sử dụng) → không an toàn. Thay đổi của nhánh khiến mã nguồn của `main` bị lỗi khi truy cập một cột/bảng hiện đã bị xóa hoặc thay đổi.

Cách tiếp cận an toàn nhất: trỏ nhánh tới một cơ sở dữ liệu dùng một lần (một `POSTGRES_DB` riêng biệt), để dữ liệu thực của bạn không bao giờ bị ảnh hưởng. Bạn đã thiết lập kết nối từ các biến `POSTGRES_*`, và `bun run nuke-db` có thể đặt lại cơ sở dữ liệu thử nghiệm.

### Rollback thủ công một migration thử nghiệm

Nếu bạn đã thử nghiệm một nhánh với cơ sở dữ liệu thực của mình và muốn hoàn tác các migration của nó sau đó, hãy sử dụng trình chạy rollback. Không giống như trình chạy tiến, công cụ này không bao giờ chạy tự động: rollback luôn là một hành động thủ công có chủ đích vì các tệp `.down.sql` thường làm mất dữ liệu.

```bash
# Preview only (dry run): show what would be rolled back
bun run migrate:down 034          # this migration + every newer applied one
bun run migrate:down --last       # only the most recently applied migration
bun run migrate:down --last=2     # the two most recently applied migrations

# Execute the rollback (runs the .down.sql files, removes schema_migrations rows)
bun run migrate:down 034 --yes
```

Lệnh này chạy các tệp `.down.sql` đã chọn theo thứ tự phiên bản giảm dần (để các mục phụ thuộc vào một migration được hoàn tác trước nó), sau đó xóa các hàng `schema_migrations` tương ứng. Khi các hàng đó đã bị xóa, trình chạy tiến sẽ áp dụng lại các migration trong lần tiếp theo bạn khởi động một nhánh vẫn chứa chúng.

> Chạy lệnh khi vẫn còn ở trên nhánh đó. Quá trình rollback đọc `NNN_description.down.sql` từ ổ đĩa. Khi bạn `git checkout main`, các tệp đó sẽ biến mất và việc rollback không còn thực hiện được nữa. Hãy rollback trước, sau đó mới chuyển nhánh.

> Quá trình này vẫn làm mất dữ liệu. Việc rollback `034` ở đây sẽ chạy `DROP TABLE short_term_memories`, do đó bất kỳ dữ liệu nào được tạo trong quá trình thử nghiệm đều sẽ bị xóa. Điều đó hoàn toàn bình thường đối với việc dọn dẹp thử nghiệm, nhưng đừng bao giờ chạy `migrate:down` với dữ liệu bạn muốn giữ lại mà không có bản sao lưu.

## Xem thêm

- [Tài liệu schema cơ sở dữ liệu](/en/architecture/subsystems/database-schema/): tìm hiểu cấu trúc schema hiện tại
- [Tài liệu Bun](https://bun.sh): tìm hiểu các nguyên tắc cơ bản của runtime Bun
