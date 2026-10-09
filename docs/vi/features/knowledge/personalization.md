---
title: "Cá nhân hóa"
sidebar:
  order: 3
---

TomoriBot có thể ghi nhớ thông tin cá nhân, tên tùy chỉnh và thông tin đăng nhập của nhà cung cấp AI theo bạn trên mọi máy chủ mà bạn chia sẻ với cô ấy. Bạn có thể quản lý các cài đặt này bằng các lệnh `/personal` mà không thay đổi cấu hình chia sẻ của bất kỳ máy chủ nào.

## Bộ nhớ cá nhân

Những thông tin cô ấy biết hoặc nhớ về bạn sẽ theo bạn giữa các máy chủ. Việc quản lý chúng (thêm, xóa, xuất hoặc xóa ngữ cảnh) được đề cập trên trang [Bộ nhớ](/vi/features/knowledge/memory/#personal-vs-server-memories).

## Hồ sơ và tên theo persona

Định cấu hình cách TomoriBot đánh địa chỉ và đề cập đến bạn trên các máy chủ trong `/personal config` > `Hồ sơ`.

### Chi tiết hồ sơ

Trong `/personal config` > `Hồ sơ` > Tùy chọn chung, phần **Giới thiệu về bạn** lưu trữ ba tùy chọn độc lập, tùy chọn:

- **Nhận dạng giới tính**: mô tả giới tính của bạn.
- **Đại từ**: đại từ ưa thích của bạn.
- **Cách xưng hô**: chọn cách đặt tên nam tính, nữ tính hoặc trung tính của cá nhân. Trung lập là mặc định.

TomoriBot không bao giờ suy ra trường này từ trường khác. Các trường trống sẽ bị xóa và bỏ qua khỏi ngữ cảnh được nhắc. Các trường hồ sơ thô chỉ được hiển thị với AI khi mức độ riêng tư của bạn được đặt thành `Không có`.

Phần **Giao diện** cho phép bạn đặt độ lệch UTC bằng số (-12 đến +14) hoặc khớp với giá trị mặc định của máy chủ. TomoriBot chỉ lưu trữ phần bù số này, không bao giờ lưu trữ vị trí địa lý hoặc múi giờ IANA.

### Đặt tên kế thừa

Trong `/personal config` > `Hồ sơ` > Tùy chọn chung hoặc Tùy chọn dành riêng cho Persona, bạn có thể đặt biệt hiệu, tiền tố hoặc hậu tố:

- **Phạm vi toàn cầu**: áp dụng cho tất cả các cá nhân trừ khi bị ghi đè.
- **Phạm vi cá nhân**: chỉ áp dụng cho một dòng cá nhân cụ thể trên các máy chủ.

Tên phân giải từ cụ thể nhất đến ít cụ thể nhất:

1. **Tùy chọn cá nhân**: biệt hiệu tùy chỉnh được đặt cho cá tính đó.
2. **Tùy chọn chung**: biệt hiệu tùy chỉnh được đặt cho tất cả các cá tính.
3. **Tên hiển thị Discord**: tên hiển thị máy chủ trực tiếp của bạn.

Để trống biệt hiệu chung của bạn cho phép TomoriBot tự động theo dõi tên hiển thị Discord của bạn, bao gồm cả những thay đổi trong tương lai. Việc lưu biệt hiệu chung tùy chỉnh sẽ đóng băng giá trị đó cho đến khi bạn xóa nó.

Tiền tố và hậu tố kế thừa theo cùng một cách. Ví dụ: tiền tố từ một cấp độ và hậu tố từ cấp độ khác có thể kết hợp thành `Master Mirri-san`. Để ngăn một persona sử dụng chức danh do chính họ tạo ra, hãy hỏi trực tiếp persona đó trong cuộc trò chuyện ("đừng gọi tôi là Chủ nhân"); loại bỏ tiêu đề cho tính cách đó trong khi không chạm tới các tính cách khác.

Người quản lý máy chủ định cấu hình mặc định tính cách trên toàn máy chủ trong `/config` > `Persona` > `Danh tính & Tính cách`. Khi bật khả năng `Cập nhật thông tin người dùng`, các cá nhân cũng có thể cập nhật chi tiết hồ sơ của bạn khi được yêu cầu trong cuộc trò chuyện.

## Nhà cung cấp của riêng bạn
<!-- anchor: your-own-providers -->

Các nhà cung cấp cá nhân cho phép các yêu cầu của riêng bạn sử dụng các khóa và kiểu API của riêng bạn thay vì mặc định của máy chủ. Đây là khóa mang theo của riêng bạn (BYOK) ở cấp độ người dùng cá nhân.

Hai phạm vi có sẵn:

- **Mặc định của máy chủ**: thông tin xác thực và model được chia sẻ được người quản lý máy chủ định cấu hình trong `/providers` và `/model`. Áp dụng cho tất cả mọi người trong máy chủ.
- **Ghi đè cá nhân**: thông tin xác thực và kiểu máy được định cấu hình trong `/personal providers` và `/personal config`. Chỉ áp dụng cho các yêu cầu của bạn trên mọi máy chủ nơi bạn sử dụng TomoriBot.

### Cài đặt

1. Chạy `/personal providers` để lưu nhà cung cấp (khóa API của bạn được mã hóa). Việc lưu nhà cung cấp sẽ cho phép ghi đè văn bản cá nhân của bạn ngay lập tức bằng model mặc định của nhà cung cấp đó.
2. Chạy `/personal config` > `Model` > Chuyển model để chọn một model khác để ghi đè văn bản cá nhân của bạn.
3. Quay lại `/personal providers` bất cứ khi nào bạn cần cập nhật thông tin xác thực, quản lý điểm cuối tùy chỉnh hoặc thêm đăng ký model tùy chỉnh.

Việc chuyển một khả năng từ mặc định của máy chủ sang tùy chỉnh cá nhân sẽ hiển thị lời nhắc xác nhận trước khi lưu. Cập nhật thông tin xác thực cho nhà cung cấp mà bạn đã sử dụng sẽ bỏ qua xác nhận.

Thuộc tính nhật ký suy nghĩ lần lượt sử dụng khóa cá nhân của bạn cho bạn. Bạn có thể điều chỉnh các thông số model cá nhân của mình (nhiệt độ, top-p, giới hạn mã thông báo) trong `/personal config` > `Model` > Bộ lấy mẫu & Thông số. Để đăng ký điểm cuối tùy chỉnh riêng tư, hãy xem [Điểm cuối tùy chỉnh](/vi/features/setup-administration/providers-and-models/#custom-endpoints).

### Xử lý lỗi và dự phòng

Nếu yêu cầu không thành công khi sử dụng nhà cung cấp cá nhân của bạn, các mẹo xử lý lỗi sẽ hướng bạn đến các lệnh cá nhân của bạn (`/personal providers`, `/personal config`) thay vì cài đặt máy chủ.

Khi mọi model trên tuyến văn bản cá nhân của bạn bị lỗi, TomoriBot có thể quay trở lại model văn bản mặc định của máy chủ thay vì bị lỗi âm thầm. Dự phòng máy chủ chạy dựa trên thông tin xác thực của máy chủ, được tính vào hạn ngạch văn bản của máy chủ và hiển thị nút `Đã dùng dự phòng` kèm theo thông tin chi tiết.

Bạn có thể tắt tính năng dự phòng máy chủ trong `/personal config` > `Model` > Dự phòng trong `Dự phòng bằng model máy chủ`. Cài đặt này áp dụng cho toàn bộ tài khoản và được bật theo mặc định.

:::note[BYOK-required servers]
Máy chủ có thể yêu cầu các thành viên cung cấp khóa API của riêng họ thông qua chế độ BYOK của người dùng ([Kiểm duyệt máy chủ](/vi/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)). Khi được bật, tin nhắn của bạn yêu cầu nhà cung cấp cá nhân được định cấu hình trước khi TomoriBot phản hồi và các tuyến cá nhân không thành công sẽ không quay trở lại thông tin xác thực của máy chủ.
:::

## Các cài đặt cá nhân khác

Sử dụng `/personal config` để tùy chỉnh các tính năng bổ sung:

- **Giao diện** (`Hồ sơ` > `Diện mạo`): lưu các thẻ giao diện kiểu booru được sử dụng bất cứ khi nào [tạo hình ảnh](/vi/features/capabilities/media-generation/image-generation/#tag-customization) tham chiếu đến bạn. Gửi một hộp trống để xóa chúng.
- **Kiểm soát quyền riêng tư** (`Quyền riêng tư` > `Kiểm soát quyền riêng tư`): chọn mức độ hiển thị của bạn (`Không có`, `Một phần` hoặc `Đầy đủ`) hoặc chuyển đổi chia sẻ bộ nhớ ngắn hạn trên nhiều máy chủ.
- **Chế độ phản hồi** (`Nâng cao` > `Chế độ phản hồi`): chuyển đổi tùy chỉnh cá nhân của bạn cho [Chế độ kích hoạt có chủ ý](/vi/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- **Mạo danh** (`Nâng cao` > `Mạo danh`): đặt lời nhắc có thể sử dụng lại được sử dụng khi ai đó gọi `/impersonate user` cho bạn.

## Tiêu điểm cá nhân
<!-- anchor: personal-spotlight -->

Tiêu điểm cá nhân thu hẹp những cá tính nào bạn có thể kích hoạt trong một kênh cụ thể và tùy ý chỉ định một cá tính tự động kích hoạt dự phòng cho tin nhắn của bạn ở đó. Nó nằm trong phạm vi của bạn và một kênh: nó không ảnh hưởng đến bất kỳ ai khác trong máy chủ.

Để định cấu hình đèn chiếu trong `/personal config` > `Nâng cao` > Đèn chiếu cá nhân:

1. Chọn thời lượng tính bằng giờ (nhập `0` để duy trì thời lượng cho đến khi bị xóa theo cách thủ công).
2. Chọn kênh mục tiêu.
3. Chọn những cá tính mà bạn muốn cho phép mình được chú ý.
4. Tùy ý chọn một trong những persona đó làm **persona tự động kích hoạt cá nhân** của bạn (người trả lời mặc định cho tin nhắn của bạn trong kênh đó). Những đề cập rõ ràng vẫn có thể nhắm mục tiêu đến bất kỳ cá nhân nào được phép. Nhấn `Lưu spotlight` để bỏ qua cài đặt tính cách tự động kích hoạt.

### Quy tắc tiêu điểm

- Tiêu điểm chỉ thu hẹp quyền truy cập: bạn không thể kích hoạt các cá nhân bị loại khỏi danh sách tiêu điểm của mình.
- Nó tôn trọng các quyền cá nhân cấp máy chủ được định cấu hình trong `/moderation`.
- Việc chuyển giao proxy Persona được giới hạn ở những Persona có trong danh sách tiêu điểm của bạn.

Quản lý hoặc xóa tiêu điểm trong `/personal config` > `Nâng cao` > Tiêu điểm cá nhân (bỏ chọn các mục để xóa chúng; tiêu điểm định giờ sẽ tự động hết hạn). Trong `/help`, chọn `Nâng cao` > `Spotlight cá nhân` để xem tóm tắt nhanh.
