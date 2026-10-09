---
title: "Tinh chỉnh hành vi"
sidebar:
  order: 3
---

Bạn có thể điều chỉnh các hành động TomoriBot được phép thực hiện và cách bot tạo câu trả lời trong `/config`, bao gồm trang quyền hạn. Xem [Nhiều persona](/vi/features/chatting-personality/multiple-personas/) để chỉnh tính cách và [Bộ nhớ](/vi/features/knowledge/memory/) để chỉnh kiến thức. Trang này giới thiệu các cài đặt thường dùng.

## Tính năng: Những gì bot được phép làm
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > `Plugin` kiểm soát các công cụ, bổ sung ngữ cảnh và duyệt phản hồi tùy chọn:

- **Các `Công cụ khả dụng`**: tạo hình ảnh, `Sử dụng sticker`, tạo chủ đề, quản lý tin nhắn, chặn người dùng, tự dạy, tin nhắn thoại, v.v. Mỗi nút chuyển đổi sẽ chuyển đổi công cụ phù hợp (xem [Công cụ & Tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/)), do đó, việc tắt `Sử dụng công cụ` sẽ vô hiệu hóa tất cả chúng cùng một lúc.
- **`Bổ sung ngữ cảnh`**: cá nhân hóa, biểu tượng cảm xúc trong câu trả lời và nhận thức về thời gian. Những thông tin này thêm thông tin vào lời nhắc của cô ấy để chúng tiếp tục hoạt động khi tính năng `Sử dụng công cụ` bị tắt.

Tính năng tóm tắt bộ nhớ ngắn hạn tự động được bật trong `/config` > `Hành vi` > `Bộ nhớ nâng cao`. Khi một khả năng bị tắt, cô ấy không thể thực hiện hành động đó bất kể người dùng có yêu cầu hay không.

## Duyệt bản nháp phản hồi

Mở `/config` > `Plugin` > `Duyệt phản hồi` để bật tính năng duyệt. Tính năng này bắt đầu ở trạng thái Tắt và áp dụng cho mọi persona trong không gian làm việc đó, bao gồm cả câu trả lời trong hàng đợi và phân cảnh được tạo. Người quản lý máy chủ có thể thay đổi cài đặt máy chủ; không gian làm việc DM của bạn có cài đặt riêng.

Khi Bật, Tomori giữ lại câu trả lời trong khi người duyệt kiểm tra giọng điệu nhân vật và sự phù hợp với phân cảnh. Người duyệt có thể yêu cầu một lần sửa đổi hoàn chỉnh. Các yêu cầu công cụ cũng được đưa vào duyệt trước khi thực thi; các yêu cầu bị từ chối có thể nhận được sửa đổi trong giới hạn. Các hành động thành công được giữ lại trong khi câu trả lời được sửa đổi. Văn bản vẫn sử dụng danh tính persona thông thường, cách xử lý emoji và định dạng. Việc duyệt và sửa đổi có thể làm tăng thời gian phản hồi và chi phí token; trang này hiển thị điều đó ở cả hai trạng thái.

`Chọn model duyệt` chọn một model văn bản đã đăng ký đủ điều kiện. `Dùng model phản hồi hiện tại` sử dụng model và thông tin xác thực thực sự trả lời, bao gồm cả nhà cung cấp cá nhân của bạn hoặc model dự phòng. Người duyệt được ghim sử dụng thông tin đăng ký và xác thực riêng của không gian làm việc. Tác giả chỉ dùng văn bản và tác giả đã tắt Sử dụng công cụ vẫn có thể sử dụng người duyệt đủ điều kiện. Model kế thừa không được hỗ trợ sẽ hiển thị `Không khả dụng`; hãy chọn người duyệt được hỗ trợ để bật duyệt chi tiết.

`Đặt prompt` chỉnh sửa hướng dẫn duyệt, tối đa 4.000 ký tự. `Dùng mặc định` khôi phục mặc định nhận biết persona. `Chọn công cụ kiểm tra quy tắc` chọn một công cụ kiểm tra MCP tương thích đã đăng ký, hoặc `Không có`. Kết quả của nó được gửi riêng cho người duyệt, người duyệt sẽ quyết định xem chúng có quan trọng đối với nhân vật này hay không. Công cụ kiểm tra không có bảo đảm ngôn ngữ/hồ sơ đã được xác thực trong bản phát hành này.

`Chọn model quyết định` lưu một đăng ký Quyết định từ `/providers`. Việc bỏ qua duyệt chi tiết sẽ không hoạt động cho đến khi mỗi model và tiêu chí duyệt có bằng chứng chất lượng được gắn nhãn. Lựa chọn đã lưu không thực hiện các yêu cầu Quyết định trả phí trong bản phát hành này. Prompt tùy chỉnh cũng giữ cho tính năng bỏ qua không hoạt động. Việc xóa một trong hai model sẽ khôi phục quyền kế thừa của người duyệt hoặc `Không có`; việc Tắt vẫn giữ nguyên các lựa chọn của bạn.

Duyệt là bước kiểm tra chất lượng tùy chọn. Việc từ chối, model không khả dụng, hết thời gian chờ, bằng chứng không đầy đủ hoặc hết ngân sách duyệt sẽ cho phép một câu trả lời hợp lệ hoặc yêu cầu công cụ độc lập tiếp tục theo các quy tắc ứng dụng thông thường. Các hành động bị từ chối trước đó vẫn bị chặn. `/kill` và việc ngắt quãng tiếp theo sẽ hủy bỏ văn bản bị giữ lại. Tệp, giọng nói và bài đăng từ xa sẽ nhận được sự xem xét đối với các đối số công cụ được đề xuất của chúng; phương tiện được tạo ra của chúng nằm ngoài phạm vi duyệt văn bản bị giữ lại. Tạo nội dung ẩn và mạo danh người dùng vẫn giữ nguyên các đường dẫn hiện có. Sự phán đoán của nhà cung cấp và tính hữu ích của công cụ kiểm tra vẫn cần sự đánh giá của con người. Xem [xử lý dữ liệu duyệt](/vi/features/knowledge/data-handling/#response-drafting-selections).

## Biểu cảm
<!-- anchor: expressions -->

Biểu cảm giúp persona phản ứng bằng nhiều cách ngoài lời nói. Bot có thể dùng emoji và sticker của máy chủ, cùng những phản ứng bạn thêm: GIF yêu thích, ảnh chế nội bộ hoặc liên kết tới bất kỳ trang web nào. Mô tả tình huống phù hợp cho mỗi biểu cảm để bot gửi đúng lúc.

Thành viên có quyền `Quản lý máy chủ` mở `/expressions manage` để xem ba tab: `Emoji`, `Sticker` và `Tùy chỉnh`.

### Emoji và sticker của máy chủ

Chạy `/expressions initialize` để bot học khi nào nên dùng từng emoji và sticker. Những mục được thêm sau sẽ hiện là chưa khởi tạo trong `/expressions manage` cho đến khi bạn chạy lại lệnh. Chọn một mục rồi dùng `Chỉnh sửa` để sửa mô tả và cảm xúc, hoặc `Xóa thông tin` để xóa thông tin đó.

### Biểu cảm tùy chỉnh

Trong `Tùy chỉnh`, mở menu và chọn `+ Thêm biểu cảm tùy chỉnh`. Nhập tên, mô tả tình huống sử dụng, cảm xúc và một liên kết hoặc tệp. Bot đọc mô tả để quyết định lúc gửi, nên hãy viết cụ thể: "khi cuộc trò chuyện trở nên hỗn loạn" hữu ích hơn "hài hước".

Liên kết có thể trỏ tới bất kỳ nội dung nào. Bot đăng nguyên liên kết đã lưu, và Discord hiển thị như mọi liên kết khác: liên kết GIF từ trang như Tenor phát GIF, liên kết ảnh hiện ảnh, còn trang web hiện thẻ xem trước. Bạn có thể dùng liên kết để đùa, chẳng hạn gửi trang web của bệnh viện khi cuộc trò chuyện trở nên hỗn loạn. Liên kết phải bắt đầu bằng `https://`.

Tệp có thể là PNG, JPEG, WebP, GIF hoặc MP4, tối đa 10 MB.

Mỗi máy chủ có thể có tối đa 20 biểu cảm tùy chỉnh theo mặc định, dùng chung cho tất cả các persona. Cả tệp và liên kết đều được tính; emoji và sticker gốc thì không. Khi đạt giới hạn, hãy xóa một biểu cảm trước khi thêm biểu cảm khác. Các biểu cảm hiện có vẫn có thể được sử dụng và chỉnh sửa. Bot tự lưu trữ có thể thay đổi giới hạn này trong cài đặt môi trường của mình.

Mọi persona đều có thể dùng biểu cảm tùy chỉnh mới. Để giới hạn cho một số persona, chọn biểu cảm và dùng `Thêm persona`. Xóa persona cuối cùng khỏi danh sách sẽ cho phép tất cả persona dùng lại.

### Cách bot sử dụng

Khi bật tính năng dùng sticker trong `/config` > `Plugin`, bot gửi tối đa một biểu cảm mỗi câu trả lời, thành tin nhắn riêng trước, giữa hoặc sau phần văn bản. Bot không dùng biểu cảm trong [kênh nhập vai](/vi/features/chatting-personality/chatting-and-triggers/#roleplay-channels). `/expressions manage` cho biết các persona đã dùng mỗi biểu cảm bao nhiêu lần.

## Tinh chỉnh quá trình tạo phản hồi
<!-- anchor: generation-tuning -->

- `/config` > `Model` > `Bộ lấy mẫu & Tham số văn bản`: các thông số lấy mẫu như nhiệt độ và top-p. Nhiệt độ cao hơn mang lại sự đa dạng hơn.
- `/config` > `Hành vi` > `Hành vi chung`: mức độ đáp ứng nhân bản. Điều chỉnh cách cô ấy nhắn tin ngẫu nhiên. Cài đặt này áp dụng trên toàn máy chủ theo mặc định hoặc cho một cá nhân.
- `/config` > `Hành vi` > `Hành vi chung`: giới hạn lịch sử tin nhắn. Tăng nó để có bối cảnh hội thoại sâu hơn hoặc hạ thấp nó để tiết kiệm mã thông báo.

## Prompt hệ thống
<!-- anchor: system-prompt -->

Lời nhắc hệ thống nằm phía trên cá tính và định hình hành vi tổng thể:

- `/config` > `Hành vi` > `Hành vi chung`: đặt hướng dẫn hệ thống tùy chỉnh (tối đa 16.000 ký tự).
- `/config` > `Hành vi` > `Hành vi chung`: chọn từ các lời nhắc hệ thống cài sẵn.
- `/config` > `Hành vi` > `Hành vi chung`: đặt lại về mặc định. Xác nhận hiển thị lời nhắc trước đó để bạn có thể khôi phục nó nếu vô tình xóa.

Khi [SillyTavern cài sẵn](/vi/features/integrations/sillytavern-support/) hoạt động, lời nhắc hệ thống dự phòng tích hợp sẽ được thay thế, nhưng lời nhắc tùy chỉnh bạn đặt ở đây vẫn được gửi.

## Đầu ra không kiểm duyệt
<!-- anchor: uncensored-output -->

TomoriBot không có bộ lọc nội dung riêng: cô ấy không thêm lớp kiểm duyệt nào lên trên model và trả lời bằng bất cứ điều gì nhà cung cấp tạo ra. `/nsfw jailbreaks` không kích hoạt các tính năng bot ẩn; nó hoạt động xung quanh các bộ lọc phía nhà cung cấp chặt chẽ hơn mong muốn.

Nó chuyển đổi ba kỹ thuật độc lập (tất cả đều tắt theo mặc định):

- **Chèn nhắc**: thêm khối lệnh vào ngữ cảnh để hướng model tránh khỏi những từ chối không cần thiết.
- **Khoảng cách Unicode**: hoán đổi các khoảng trắng bình thường thành các khoảng trắng Unicode trông giống nhau để bộ lọc từ khóa không kích hoạt các cụm từ, áp dụng cho cả lời nhắc và câu trả lời của cô ấy.
- **Khử trùng**: làm xáo trộn các từ nhạy cảm vì cùng một lý do, trên cả yêu cầu và phản hồi.

Không điều nào trong số này thay đổi những gì model có thể làm; chúng chỉ giảm tần suất bộ lọc của nhà cung cấp chặn đầu ra bình thường. Một số tùy chọn này bị giới hạn độ tuổi; xem [Lệnh giới hạn độ tuổi](/vi/features/setup-administration/age-restricted-commands/).

## Diện mạo & thời gian

- `/config` > `Persona` > `Danh tính & Tính cách`: những gì cô ấy tự gọi mình.
- `/config` > `Hành vi` > `Hành vi chung`: múi giờ của máy chủ, được sử dụng để trả lời nhận biết thời gian và các tác vụ theo lịch trình.

---

Bạn đang tìm kiếm các biện pháp kiểm soát quản trị và chi phí (hạn ngạch, danh sách trắng, BYOK) thay vì hành vi? Những người sống trong [Kiểm duyệt máy chủ](/vi/features/setup-administration/server-moderation/).
