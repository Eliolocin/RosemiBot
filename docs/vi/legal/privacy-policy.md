---
title: Chính sách quyền riêng tư
description: Cách instance TomoriBot chính thức được lưu trữ thu thập, lưu trữ và xóa dữ liệu của bạn.
aiGenerated: false
---

*Bản dịch này chỉ nhằm mục đích thuận tiện cho bạn tham khảo. Trong trường hợp có sự mâu thuẫn giữa bản dịch và bản tiếng Anh, bản tiếng Anh sẽ được ưu tiên áp dụng.*

Cập nhật lần cuối: 2026-09-12

Chính sách quyền riêng tư này giải thích cách thức instance TomoriBot chính thức được lưu trữ xử lý dữ liệu. Nếu bạn tự self-host TomoriBot từ repository này, bạn nắm toàn quyền kiểm soát dữ liệu của chính mình; tài liệu này đóng vai trò là một mẫu tham chiếu và không chi phối bản triển khai self-hosted của bạn.

Các thuật ngữ như "Máy chủ" (Server), "Bộ nhớ" (Memories), "Persona/Preset", "Nhà cung cấp" (Provider), "Kích hoạt" (Trigger) và "Khóa API" (API Key) được định nghĩa trong [Điều khoản dịch vụ](/vi/legal/terms-of-service/) của chúng tôi. Vui lòng tham khảo tài liệu đó để biết định nghĩa chi tiết.

## Tổng quan về quyền riêng tư

- Chúng tôi không lưu giữ bản sao lịch sử trò chuyện Discord của bạn. TomoriBot đọc các tin nhắn gần đây trong khi trả lời, sau đó hủy chúng.
- Nếu bộ nhớ ngắn hạn được bật, TomoriBot sẽ lưu trữ các bản tóm tắt ngắn gọn được rút ra từ các cuộc trò chuyện đó. Các bản tóm tắt này sẽ hết hạn sau một khoảng thời gian không hoạt động (mặc định là 90 ngày).
- Mọi nội dung bạn chủ động dạy TomoriBot (bộ nhớ, cài đặt persona, tài liệu đã tải lên) sẽ được lưu trữ cho đến khi có người xóa chúng.
- Khi TomoriBot trả lời, bot sẽ gửi prompt và ngữ cảnh gần đây của bạn đến nhà cung cấp AI được cấu hình cho máy chủ đó. Nhà cung cấp đó có các điều khoản và quy định về quyền riêng tư riêng mà chúng tôi không kiểm soát.
- Lệnh `/personal nuke` sẽ xóa sạch mọi thông tin chúng tôi lưu trữ về bạn trên tất cả các máy chủ.

Các phần bên dưới cung cấp thông tin chi tiết cho từng nội dung nêu trên.

## 1) Phạm vi áp dụng của chính sách

Chính sách này áp dụng cho instance TomoriBot chính thức được lưu trữ. Những người quản trị máy chủ cấu hình TomoriBot cho một Máy chủ, nhưng mọi thành viên có tin nhắn được TomoriBot xử lý đều thuộc phạm vi điều chỉnh của chính sách này, bất kể họ có tự mình thực hiện lệnh hay không.

Người quản lý máy chủ chấp nhận Điều khoản dịch vụ trong quá trình `/setup` và xác nhận tại đó rằng họ sẽ công khai thông tin này cho các thành viên của mình. Bất kỳ thành viên nào cũng có thể đọc các chính sách hiện hành bất kỳ lúc nào bằng lệnh `/legal privacy-policy` và `/legal terms-of-service`.

## 2) Dữ liệu chúng tôi lưu trữ

### 2.1) Về bạn
- Danh tính và tùy chọn: ID người dùng Discord, tùy chọn ngôn ngữ và trạng thái từ chối quyền riêng tư của bạn.
- Cài đặt cá nhân hóa: biệt danh bạn chọn, đại từ, bản dạng giới, cách xưng hô, thẻ ngoại hình, prompt giả lập nhân vật, URL hình ảnh tham chiếu nhân vật, độ lệch múi giờ và các tùy chỉnh tiền tố/hậu tố tin nhắn.
- Tùy chọn xưng hô: cách mà từng persona sẽ gọi bạn.
- Bộ nhớ cá nhân: các thông tin bạn dạy TomoriBot về bản thân, hoặc thông tin bot tự lưu về bạn khi tính năng bộ nhớ cá nhân được bật.
- Spotlight: cấu hình spotlight cá nhân mà bạn thiết lập cho từng máy chủ.
- Hồ sơ điều hướng hành vi: văn bản và lý do bạn cung cấp qua `/reward` và `/punish`, nhằm định hình cách persona hành xử trong Máy chủ đó.
- Bộ đếm sử dụng: số lượng lệnh, model và công cụ bạn đã sử dụng hàng ngày, cùng với tổng số token, được liên kết với bạn, Máy chủ và persona. Dữ liệu này dùng cho lệnh `/stats`.

### 2.2) Về máy chủ của bạn
- Cấu hình máy chủ: các thuộc tính persona, đoạn hội thoại mẫu, từ kích hoạt, lựa chọn nhà cung cấp và model, quyền hạn kênh và vai trò, hạn mức, múi giờ và các nút bật/tắt tính năng.
- Bộ nhớ máy chủ: các thông tin được dạy cho TomoriBot áp dụng cho toàn bộ Máy chủ. Những thông tin này có thể mô tả các thành viên, bao gồm cả những thành viên không trực tiếp viết ra chúng.
- Metadata của emoji và sticker: ID Discord, tên, mô tả và cờ định dạng. Bản thân các tệp hình ảnh không được lưu trữ.
- Lời nhắc nhở: nội dung lời nhắc, ID Discord và biệt danh của người dùng mục tiêu, kênh, lịch trình và mọi cài đặt lặp lại.
- Bản tóm tắt bộ nhớ ngắn hạn: khi bộ nhớ ngắn hạn được bật, TomoriBot sẽ ghi các bản tóm tắt ngắn rút ra từ cuộc trò chuyện gần đây vào cơ sở dữ liệu để duy trì ngữ cảnh giữa các lần Kích hoạt. Những bản tóm tắt này sẽ bị xóa sau một khoảng thời gian không hoạt động (mặc định là 90 ngày).
- Liên kết tích hợp: liên kết phòng và kênh Matrix, cùng với các URL, tên công cụ được phát hiện và token xác thực được mã hóa cho bất kỳ máy chủ MCP nào mà người quản lý kết nối.

### 2.3) Thông tin xác thực
- Khóa API của nhà cung cấp mà bạn chọn lưu trữ, ở cấp độ Máy chủ hoặc cá nhân.
- Định nghĩa endpoint tùy chỉnh, bao gồm URL endpoint và bất kỳ bearer token nào.

Tất cả thông tin xác thực đều được mã hóa khi lưu trữ (at rest).

### 2.4) Nội dung bạn tải lên
- Tài liệu: toàn bộ văn bản được trích xuất từ các tệp tải lên cơ sở tri thức của Máy chủ, cùng với tên tệp, loại phương tiện, kích thước và vector embedding tìm kiếm được tạo ra từ văn bản đó.
- Hình ảnh persona: avatar, sprite và hình ảnh tham chiếu nhân vật, được lưu trữ trong bộ lưu trữ đối tượng để persona có thể hiển thị nhất quán.
- Mẫu giọng nói: các mẫu âm thanh và bản ghi tham chiếu của chúng, khi tính năng nhân bản giọng nói được cấu hình.

### 2.5) Hồ sơ vận hành
- Nhật ký lỗi: ID tương tác, ID người dùng và Máy chủ, tên lệnh, loại lỗi và stack trace. Nội dung tin nhắn và cuộc trò chuyện không được ghi nhật ký. Được lưu giữ trong 90 ngày.
- Số liệu hiệu năng: các mẫu đo thời gian và tài nguyên dùng để duy trì sự ổn định của dịch vụ. Được lưu giữ trong 30 ngày.
- Ánh xạ tin nhắn persona: ID tin nhắn và kênh Discord liên kết một tin nhắn đã gửi với sprite persona được sử dụng, để TomoriBot có thể cập nhật hoặc dọn dẹp tin nhắn của chính mình. Được lưu giữ trong 30 ngày.

## 3) Dữ liệu chúng tôi không lưu trữ

Những thông tin sau chỉ được đọc trong khi TomoriBot chuẩn bị câu trả lời và không được ghi vào cơ sở dữ liệu của chúng tôi:

- Tin nhắn Discord: các tin nhắn gần đây trong kênh (thường là 80 tin nhắn gần nhất) được đọc vào bộ nhớ tạm để xây dựng ngữ cảnh và gửi đến Nhà cung cấp được cấu hình. Chúng sẽ bị hủy sau khi câu trả lời được tạo ra. Các bản tóm tắt có thể được giữ lại riêng nếu bộ nhớ ngắn hạn được bật, như đã mô tả trong Mục 2.2.
- Tệp đính kèm và phương tiện: hình ảnh, video và ảnh hồ sơ được phân tích trong quá trình Kích hoạt sẽ được xử lý trong bộ nhớ tạm và bị hủy sau đó.
- Metadata của máy chủ và kênh: tên Máy chủ, mô tả, tên kênh và chủ đề được đọc mới hoàn toàn trong mỗi lần tương tác.
- Thông tin trạng thái hoạt động: hoạt động hiện tại hoặc trạng thái của bạn, khi có sẵn.
- Hình ảnh emoji và sticker: được lấy từ Discord mỗi khi sử dụng.

## 4) Dữ liệu chúng tôi gửi cho bên thứ ba

- Nhà cung cấp AI: prompt của bạn, ngữ cảnh gần đây như mô tả ở trên, dữ liệu persona và mọi tệp đính kèm sẽ được gửi đến Nhà cung cấp được cấu hình cho Máy chủ đó hoặc cho cá nhân bạn, chẳng hạn như Google, OpenRouter, NovelAI hoặc một endpoint tùy chỉnh. Điều này bao gồm các yêu cầu về văn bản, thị giác, embedding, hình ảnh, video, giọng nói và phiên âm. Các điều khoản, chính sách quyền riêng tư, bộ lọc an toàn và quy tắc lưu giữ dữ liệu của họ sẽ áp dụng cho nội dung đó, và chúng tôi không kiểm soát những điều này.
- Nhà cung cấp tìm kiếm: nếu tính năng tìm kiếm web được bật, các truy vấn tìm kiếm và ngữ cảnh liên quan sẽ được gửi đến nhà cung cấp tìm kiếm được cấu hình.
- Matrix: nếu cầu nối Matrix được cấu hình cho một kênh, tin nhắn sẽ được chuyển tiếp qua lại giữa Discord và phòng Matrix được liên kết.

Chúng tôi không bán dữ liệu cá nhân. Chúng tôi chỉ chia sẻ dữ liệu khi cần thiết để vận hành các tính năng bạn yêu cầu, hoặc khi pháp luật có quy định bắt buộc.

## 5) Thời gian lưu giữ dữ liệu

| Dữ liệu | Thời gian lưu giữ |
|---|---|
| Bản tóm tắt bộ nhớ ngắn hạn | 90 ngày kể từ hoạt động cuối cùng (mặc định) |
| Nhật ký lỗi | 90 ngày |
| Số liệu hiệu năng | 30 ngày |
| Ánh xạ tin nhắn persona | 30 ngày |
| Mọi dữ liệu khác trong Mục 2 | Cho đến khi bị xóa thông qua các lệnh trong Mục 6 |

Khi TomoriBot bị xóa khỏi một Máy chủ, dữ liệu của Máy chủ đó vẫn được giữ lại để cấu hình không bị mất khi mời lại bot. Người quản lý muốn xóa toàn bộ dữ liệu nên chạy lệnh `/nuke` trước khi xóa bot.

## 6) Quyền kiểm soát của bạn

| Mục đích | Lệnh |
|---|---|
| Ngừng việc TomoriBot lưu bộ nhớ cá nhân về bạn | `/personal config` |
| Xem lại hoặc xóa từng mục bộ nhớ cá nhân | `/personal memories` |
| Xem lại hoặc xóa bộ nhớ máy chủ và tài liệu | `/memories` |
| Tải bản sao dữ liệu cá nhân của bạn | `/export personal config`, `/export personal memories` |
| Tải bản sao dữ liệu của Máy chủ | `/export config`, `/export memories` |
| Đặt lại cài đặt cá nhân về mặc định | `/reset personal config` |
| Xóa mọi dữ liệu chúng tôi lưu trữ về bạn trên tất cả Máy chủ | `/personal nuke` |
| Xóa dữ liệu của Máy chủ (chỉ dành cho người quản lý) | `/nuke` |

Lệnh `/personal nuke` sẽ xóa bộ nhớ cá nhân, cài đặt cá nhân hóa và xưng hô, spotlight, các khóa nhà cung cấp và endpoint cá nhân đã lưu, các model đã đăng ký, bộ đếm sử dụng, dữ liệu điều hướng persona bạn đã đóng góp, cùng mọi lời nhắc bạn đã tạo hoặc được đặt cho bạn. Có hai hệ quả bạn cần biết trước khi chạy lệnh:

- Dữ liệu điều hướng persona bạn đã đóng góp qua `/reward` và `/punish` định hình cách persona hành xử cho tất cả mọi người trong Máy chủ đó, do đó việc xóa dữ liệu này sẽ làm thay đổi hành vi chung.
- Bộ nhớ máy chủ bạn đã dạy và các tài liệu bạn đã tải lên thuộc quyền sở hữu của Máy chủ và sẽ được giữ lại, nhưng thông tin tác giả của bạn sẽ bị gỡ bỏ. Nếu có mục nào mô tả về bạn, hãy yêu cầu người quản lý xóa mục đó bằng lệnh `/memories`.

Cài đặt từ chối (opt-out) của bạn được chủ ý giữ lại sau khi xóa, để việc xóa dữ liệu không âm thầm bật lại việc thu thập thông tin về bạn.

Đối với bất kỳ yêu cầu nào mà các lệnh trên không thể thực hiện, vui lòng liên hệ với chúng tôi theo Mục 9 và chúng tôi sẽ xử lý thủ công.

## 7) Bảo mật

- Khóa API của nhà cung cấp, bearer token và thông tin xác thực MCP được mã hóa khi lưu trữ.
- Kết nối cơ sở dữ liệu sử dụng TLS có xác thực chứng chỉ.
- Quyền truy cập cơ sở dữ liệu chỉ giới hạn trong môi trường thực thi của bot và các quản trị viên có quyền truy cập cơ sở hạ tầng.

Không có hệ thống nào an toàn tuyệt đối. Vui lòng không cung cấp cho TomoriBot các thông tin nhạy cảm cao hoặc thuộc diện quản lý nghiêm ngặt.

## 8) Dữ liệu trẻ em

TomoriBot không hướng đến bất kỳ ai dưới độ tuổi tối thiểu mà Discord quy định tại quốc gia của họ, tối thiểu là 13 tuổi. Chúng tôi không cố ý thu thập dữ liệu từ người dùng dưới độ tuổi đó. Nếu bạn tin rằng chúng tôi đang lưu giữ dữ liệu về người dưới độ tuổi tối thiểu theo quy định, hãy liên hệ với chúng tôi theo Mục 9 và chúng tôi sẽ xóa dữ liệu đó.

## 9) Liên hệ

Đối với các câu hỏi hoặc yêu cầu về quyền riêng tư ngoài các lệnh nêu trên, vui lòng gửi email đến `bredrumb@gmail.com` hoặc liên hệ với chúng tôi trong [máy chủ Discord hỗ trợ chính thức của TomoriBot](https://discord.gg/bjCfHm9QsB). Vui lòng sử dụng email hoặc tin nhắn trực tiếp thay vì tạo issue công khai trên GitHub cho bất kỳ vấn đề nào liên quan đến dữ liệu cá nhân của bạn.

## 10) Thay đổi chính sách

Chúng tôi có thể cập nhật Chính sách quyền riêng tư này, và ngày "Cập nhật lần cuối" ở trên sẽ thay đổi khi có cập nhật. Những thay đổi quan trọng sẽ được thông báo qua Discord hỗ trợ hoặc repository của dự án.

## 11) Người dùng quốc tế và GDPR

- Dịch vụ lưu trữ của TomoriBot khả dụng trên toàn cầu, và dữ liệu được lưu trữ trên cơ sở hạ tầng do nhà cung cấp dịch vụ lưu trữ của chúng tôi vận hành.
- Nếu bạn ở Khu vực Kinh tế Châu Âu (EEA), Vương quốc Anh hoặc Thụy Sĩ, bạn có các quyền theo GDPR để truy cập, cải chính, xóa, hạn chế và chuyển dữ liệu cá nhân của mình, cũng như phản đối việc xử lý dữ liệu.
- Các quyền kiểm soát trong Mục 6 bao gồm trực tiếp việc truy cập, chuyển dữ liệu và xóa dữ liệu. Đối với bất kỳ vấn đề nào khác, vui lòng liên hệ với chúng tôi theo Mục 9.
- Chúng tôi dựa trên các cơ sở pháp lý sau: thực hiện hợp đồng để vận hành các tính năng bạn yêu cầu; lợi ích hợp pháp cho mục đích bảo mật, ngăn chặn lạm dụng và sự ổn định của dịch vụ; và sự đồng ý đối với các tính năng tùy chọn mà bạn kích hoạt, chẳng hạn như bộ nhớ cá nhân, bộ nhớ ngắn hạn và tìm kiếm web. Bạn có thể rút lại sự đồng ý đó bằng cách tắt tính năng tương ứng.
